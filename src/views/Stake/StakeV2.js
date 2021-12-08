import React, { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { useWeb3React } from '@web3-react/core'
import { Pool } from '@uniswap/v3-sdk'
import { Token as UniToken } from '@uniswap/sdk-core'

import Modal from '../../components/Modal/Modal'
import Checkbox from '../../components/Checkbox/Checkbox'
import Tooltip from '../../components/Tooltip/Tooltip'
import Footer from "../../Footer"

import Vault from '../../abis/Vault.json'
import ReaderV2 from '../../abis/ReaderV2.json'
import Vester from '../../abis/Vester.json'
import RewardRouter from '../../abis/RewardRouter.json'
import RewardReader from '../../abis/RewardReader.json'
import Token from '../../abis/Token.json'
import GlpManager from '../../abis/GlpManager.json'
import UniPool from '../../abis/UniPool.json'

import { ethers } from 'ethers'
import {
  helperToast,
  bigNumberify,
  fetcher,
  formatAmount,
  formatKeyAmount,
  formatAmountFree,
  expandDecimals,
  parseValue,
  approveTokens,
  getServerUrl,
  switchNetwork,
  useLocalStorageSerializeKey,
  ARBITRUM,
  GLP_DECIMALS,
  USD_DECIMALS,
  BASIS_POINTS_DIVISOR,
  SECONDS_PER_YEAR
} from '../../Helpers'
import { callContract } from '../../Api'

import useSWR from 'swr'

import { getContract } from '../../Addresses'

import './StakeV2.css';

const { AddressZero } = ethers.constants

function getBalanceAndSupplyData(balances) {
  if (!balances || balances.length === 0) {
    return {}
  }

  const keys = ["gmx", "esGmx", "glp", "stakedGmxTracker"]
  const balanceData = {}
  const supplyData = {}
  const propsLength = 2

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    balanceData[key] = balances[i * propsLength]
    supplyData[key] = balances[i * propsLength + 1]
  }

  return { balanceData, supplyData }
}

function getDepositBalanceData(depositBalances) {
  if (!depositBalances || depositBalances.length === 0) {
    return
  }

  const keys = ["gmxInStakedGmx", "esGmxInStakedGmx", "stakedGmxInBonusGmx", "bonusGmxInFeeGmx", "bnGmxInFeeGmx", "glpInStakedGlp"]
  const data = {}

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    data[key] = depositBalances[i]
  }

  return data
}

function getVestingData(vestingInfo) {
  if (!vestingInfo || vestingInfo.length === 0) {
    return
  }

  const keys = ["gmxVester", "glpVester"]
  const data = {}
  const propsLength = 7

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    data[key] = {
      pairAmount: vestingInfo[i * propsLength],
      vestedAmount: vestingInfo[i * propsLength + 1],
      escrowedBalance: vestingInfo[i * propsLength + 2],
      claimedAmounts: vestingInfo[i * propsLength + 3],
      claimable: vestingInfo[i * propsLength + 4],
      maxVestableAmount: vestingInfo[i * propsLength + 5],
      averageStakedAmount: vestingInfo[i * propsLength + 6],
    }

    data[key + "PairAmount"] = data[key].pairAmount
    data[key + "VestedAmount"] = data[key].vestedAmount
    data[key + "EscrowedBalance"] = data[key].escrowedBalance
    data[key + "ClaimSum"] = data[key].claimedAmounts.add(data[key].claimable)
    data[key + "Claimable"] = data[key].claimable
    data[key + "MaxVestableAmount"] = data[key].maxVestableAmount
    data[key + "AverageStakedAmount"] = data[key].averageStakedAmount
  }

  return data
}

function getStakingData(stakingInfo) {
  if (!stakingInfo || stakingInfo.length === 0) {
    return
  }

  const keys = ["stakedGmxTracker", "bonusGmxTracker", "feeGmxTracker", "stakedGlpTracker", "feeGlpTracker"]
  const data = {}
  const propsLength = 5

  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]
    data[key] = {
      claimable: stakingInfo[i * propsLength],
      tokensPerInterval: stakingInfo[i * propsLength + 1],
      averageStakedAmounts: stakingInfo[i * propsLength + 2],
      cumulativeRewards: stakingInfo[i * propsLength + 3],
      totalSupply: stakingInfo[i * propsLength + 4]
    }
  }

  return data
}

function getProcessedData(balanceData, supplyData, depositBalanceData, stakingData, vestingData, aum, nativeTokenPrice, stakedGmxSupply, gmxPrice, gmxSupply) {
  if (!balanceData || !supplyData || !depositBalanceData || !stakingData || !vestingData || !aum || !nativeTokenPrice || !stakedGmxSupply || !gmxPrice || !gmxSupply) {
    return {}
  }

  const data = {}

  data.gmxBalance = balanceData.gmx
  data.gmxBalanceUsd = balanceData.gmx.mul(gmxPrice).div(expandDecimals(1, 18))

  data.gmxSupply = bigNumberify(gmxSupply)

  data.gmxSupplyUsd = supplyData.gmx.mul(gmxPrice).div(expandDecimals(1, 18))
  data.stakedGmxSupply = stakedGmxSupply
  data.stakedGmxSupplyUsd = stakedGmxSupply.mul(gmxPrice).div(expandDecimals(1, 18))
  data.gmxInStakedGmx = depositBalanceData.gmxInStakedGmx
  data.gmxInStakedGmxUsd = depositBalanceData.gmxInStakedGmx.mul(gmxPrice).div(expandDecimals(1, 18))

  data.esGmxBalance = balanceData.esGmx
  data.esGmxBalanceUsd = balanceData.esGmx.mul(gmxPrice).div(expandDecimals(1, 18))

  data.stakedGmxTrackerSupply = supplyData.stakedGmxTracker
  data.stakedEsGmxSupply = data.stakedGmxTrackerSupply.sub(data.stakedGmxSupply)
  data.stakedEsGmxSupplyUsd = data.stakedEsGmxSupply.mul(gmxPrice).div(expandDecimals(1, 18))

  data.esGmxInStakedGmx = depositBalanceData.esGmxInStakedGmx
  data.esGmxInStakedGmxUsd = depositBalanceData.esGmxInStakedGmx.mul(gmxPrice).div(expandDecimals(1, 18))

  data.bnGmxInFeeGmx = depositBalanceData.bnGmxInFeeGmx
  data.bonusGmxInFeeGmx = depositBalanceData.bonusGmxInFeeGmx
  data.feeGmxSupply = stakingData.feeGmxTracker.totalSupply
  data.feeGmxSupplyUsd = data.feeGmxSupply.mul(gmxPrice).div(expandDecimals(1, 18))

  data.stakedGmxTrackerRewards = stakingData.stakedGmxTracker.claimable
  data.stakedGmxTrackerRewardsUsd = stakingData.stakedGmxTracker.claimable.mul(gmxPrice).div(expandDecimals(1, 18))

  data.bonusGmxTrackerRewards = stakingData.bonusGmxTracker.claimable

  data.feeGmxTrackerRewards = stakingData.feeGmxTracker.claimable
  data.feeGmxTrackerRewardsUsd = stakingData.feeGmxTracker.claimable.mul(nativeTokenPrice).div(expandDecimals(1, 18))

  data.stakedGmxTrackerAnnualRewardsUsd = stakingData.stakedGmxTracker.tokensPerInterval.mul(SECONDS_PER_YEAR).mul(gmxPrice).div(expandDecimals(1, 18))
  data.gmxAprForEsGmx = data.stakedGmxTrackerAnnualRewardsUsd.mul(BASIS_POINTS_DIVISOR).div(data.stakedGmxSupplyUsd)
  data.feeGmxTrackerAnnualRewardsUsd = stakingData.feeGmxTracker.tokensPerInterval.mul(SECONDS_PER_YEAR).mul(nativeTokenPrice).div(expandDecimals(1, 18))
  data.gmxAprForETH = data.feeGmxTrackerAnnualRewardsUsd.mul(BASIS_POINTS_DIVISOR).div(data.feeGmxSupplyUsd)
  data.gmxAprTotal = data.gmxAprForETH.add(data.gmxAprForEsGmx)

  data.totalGmxRewardsUsd = data.stakedGmxTrackerRewardsUsd.add(data.feeGmxTrackerRewardsUsd)

  data.glpSupply = supplyData.glp
  data.glpPrice = aum.mul(expandDecimals(1, GLP_DECIMALS)).div(data.glpSupply)
  data.glpSupplyUsd = supplyData.glp.mul(data.glpPrice).div(expandDecimals(1, 18))

  data.glpBalance = depositBalanceData.glpInStakedGlp
  data.glpBalanceUsd = depositBalanceData.glpInStakedGlp.mul(data.glpPrice).div(expandDecimals(1, GLP_DECIMALS))

  data.stakedGlpTrackerRewards  = stakingData.stakedGlpTracker.claimable
  data.stakedGlpTrackerRewardsUsd = stakingData.stakedGlpTracker.claimable.mul(gmxPrice).div(expandDecimals(1, 18))

  data.feeGlpTrackerRewards = stakingData.feeGlpTracker.claimable
  data.feeGlpTrackerRewardsUsd = stakingData.feeGlpTracker.claimable.mul(nativeTokenPrice).div(expandDecimals(1, 18))

  data.stakedGlpTrackerAnnualRewardsUsd = stakingData.stakedGlpTracker.tokensPerInterval.mul(SECONDS_PER_YEAR).mul(gmxPrice).div(expandDecimals(1, 18))
  data.glpAprForEsGmx = data.stakedGlpTrackerAnnualRewardsUsd.mul(BASIS_POINTS_DIVISOR).div(data.glpSupplyUsd)
  data.feeGlpTrackerAnnualRewardsUsd = stakingData.feeGlpTracker.tokensPerInterval.mul(SECONDS_PER_YEAR).mul(nativeTokenPrice).div(expandDecimals(1, 18))
  data.glpAprForETH = data.feeGlpTrackerAnnualRewardsUsd.mul(BASIS_POINTS_DIVISOR).div(data.glpSupplyUsd)
  data.glpAprTotal = data.glpAprForETH.add(data.glpAprForEsGmx)

  data.totalGlpRewardsUsd = data.stakedGlpTrackerRewardsUsd.add(data.feeGlpTrackerRewardsUsd)

  data.totalEsGmxRewards = data.stakedGmxTrackerRewards.add(data.stakedGlpTrackerRewards)
  data.totalEsGmxRewardsUsd = data.stakedGmxTrackerRewardsUsd.add(data.stakedGlpTrackerRewardsUsd)

  data.gmxVesterRewards = vestingData.gmxVester.claimable
  data.glpVesterRewards = vestingData.glpVester.claimable
  data.totalVesterRewards = data.gmxVesterRewards.add(data.glpVesterRewards)
  data.totalVesterRewardsUsd = data.totalVesterRewards.mul(gmxPrice).div(expandDecimals(1, 18))

  data.totalETHRewards = data.feeGmxTrackerRewards.add(data.feeGlpTrackerRewards)
  data.totalETHRewardsUsd = data.feeGmxTrackerRewardsUsd.add(data.feeGlpTrackerRewardsUsd)

  data.totalRewardsUsd = data.totalEsGmxRewardsUsd.add(data.totalETHRewardsUsd).add(data.totalVesterRewardsUsd)

  return data
}

function StakeModal(props) {
  const { isVisible, setIsVisible, chainId, title, maxAmount, value, setValue,
    active, account, library, stakingTokenSymbol, stakingTokenAddress,
    farmAddress, rewardRouterAddress, stakeMethodName, setPendingTxns } = props
  const [isStaking, setIsStaking] = useState(false)
  const [isApproving, setIsApproving] = useState(false)

  const { data: tokenAllowance, mutate: updateTokenAllowance } = useSWR([active, chainId, stakingTokenAddress, "allowance", account, farmAddress], {
    fetcher: fetcher(library, Token),
  })

  useEffect(() => {
    if (active) {
      library.on('block', () => {
        updateTokenAllowance(undefined, true)
      })
      return () => {
        library.removeAllListeners('block')
      }
    }
  }, [active, library, updateTokenAllowance])

  let amount = parseValue(value, 18)
  const needApproval = farmAddress !== AddressZero && tokenAllowance && amount && amount.gt(tokenAllowance)

  const getError = () => {
    if (!amount || amount.eq(0)) { return "Enter an amount" }
    if (maxAmount && amount.gt(maxAmount)) {
      return "Max amount exceeded"
    }
  }

  const onClickPrimary = () => {
    if (needApproval) {
      approveTokens({
        setIsApproving,
        library,
        tokenAddress: stakingTokenAddress,
        spender: farmAddress,
        chainId
      })
      return
    }

    setIsStaking(true)
    const contract = new ethers.Contract(rewardRouterAddress, RewardRouter.abi, library.getSigner())

    callContract(chainId, contract, stakeMethodName, [amount], {
      sentMsg: "Stake submitted!",
      failMsg: "Stake failed.",
      setPendingTxns
    })
    .then(async (res) => {
      setIsVisible(false)
    })
    .finally(() => {
      setIsStaking(false)
    })
  }

  const isPrimaryEnabled = () => {
    const error = getError()
    if (error) { return false }
    if (isApproving) { return false }
    if (isStaking) { return false }
    return true
  }

  const getPrimaryText = () => {
    const error = getError()
    if (error) { return error }
    if (isApproving) { return `Approving ${stakingTokenSymbol}...` }
    if (needApproval) { return `Approve ${stakingTokenSymbol}` }
    if (isStaking) { return "Staking..." }
    return "Stake"
  }

  return (
    <div className="StakeModal">
      <Modal isVisible={isVisible} setIsVisible={setIsVisible} label={title}>
        <div className="Exchange-swap-section">
          <div className="Exchange-swap-section-top">
            <div className="muted">
              <div className="Exchange-swap-usd">
                Stake
              </div>
            </div>
            <div className="muted align-right clickable" onClick={() => setValue(formatAmountFree(maxAmount, 18, 18))}>Max: {formatAmount(maxAmount, 18, 4, true)}</div>
          </div>
          <div className="Exchange-swap-section-bottom">
            <div>
              <input type="number" placeholder="0.0" className="Exchange-swap-input" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="PositionEditor-token-symbol">
              {stakingTokenSymbol}
            </div>
          </div>
        </div>
        <div className="Exchange-swap-button-container">
          <button className="App-cta Exchange-swap-button" onClick={ onClickPrimary } disabled={!isPrimaryEnabled()}>
            {getPrimaryText()}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function UnstakeModal(props) {
  const { isVisible, setIsVisible, chainId, title,
    maxAmount, value, setValue, library, unstakingTokenSymbol,
    rewardRouterAddress, unstakeMethodName, multiplierPointsAmount,
    reservedAmount, bonusGmxInFeeGmx, setPendingTxns } = props
  const [isUnstaking, setIsUnstaking] = useState(false)

  let amount = parseValue(value, 18)
  let burnAmount

  if (multiplierPointsAmount && multiplierPointsAmount.gt(0) && amount && amount.gt(0) && bonusGmxInFeeGmx && bonusGmxInFeeGmx.gt(0)) {
    burnAmount = multiplierPointsAmount.mul(amount).div(bonusGmxInFeeGmx)
  }

  const shouldShowReductionAmount = true
  let rewardReductionBasisPoints
  if (burnAmount && bonusGmxInFeeGmx) {
    rewardReductionBasisPoints = burnAmount.mul(BASIS_POINTS_DIVISOR).div(bonusGmxInFeeGmx)
  }

  const getError = () => {
    if (!amount) { return "Enter an amount" }
    if (amount.gt(maxAmount)) {
      return "Max amount exceeded"
    }
  }

  const onClickPrimary = () => {
    setIsUnstaking(true)
    const contract = new ethers.Contract(rewardRouterAddress, RewardRouter.abi, library.getSigner())
    callContract(chainId, contract, unstakeMethodName, [amount], {
      sentMsg: "Unstake submitted!",
      failMsg: "Unstake failed.",
      successMsg: "Unstake completed.",
      setPendingTxns
    })
    .then(async (res) => {
      setIsVisible(false)
    })
    .finally(() => {
      setIsUnstaking(false)
    })
  }

  const isPrimaryEnabled = () => {
    const error = getError()
    if (error) { return false }
    if (isUnstaking) { return false }
    return true
  }

  const getPrimaryText = () => {
    const error = getError()
    if (error) { return error }
    if (isUnstaking) { return "Unstaking..." }
    return "Unstake"
  }

  return (
    <div className="StakeModal">
      <Modal isVisible={isVisible} setIsVisible={setIsVisible} label={title}>
        <div className="Exchange-swap-section">
          <div className="Exchange-swap-section-top">
            <div className="muted">
              <div className="Exchange-swap-usd">
                Unstake
              </div>
            </div>
            <div className="muted align-right clickable" onClick={() => setValue(formatAmountFree(maxAmount, 18, 18))}>Max: {formatAmount(maxAmount, 18, 4, true)}</div>
          </div>
          <div className="Exchange-swap-section-bottom">
            <div>
              <input type="number" placeholder="0.0" className="Exchange-swap-input" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="PositionEditor-token-symbol">
              {unstakingTokenSymbol}
            </div>
          </div>
        </div>
        {reservedAmount && reservedAmount.gt(0) && <div className="Modal-note">
          You have {formatAmount(reservedAmount, 18, 2, true)} tokens reserved for vesting.
        </div>}
        {(burnAmount && burnAmount.gt(0) && rewardReductionBasisPoints && rewardReductionBasisPoints.gt(0)) && <div className="Modal-note">
          Unstaking will burn&nbsp;
          <a href="https://gmxio.gitbook.io/gmx/rewards" target="_blank" rel="noopener noreferrer">{formatAmount(burnAmount, 18, 4, true)} Multiplier Points</a>.&nbsp;
          {shouldShowReductionAmount && <span>Boost Percentage: -{formatAmount(rewardReductionBasisPoints, 2, 2)}%.</span>}
        </div>}
        <div className="Exchange-swap-button-container">
          <button className="App-cta Exchange-swap-button" onClick={ onClickPrimary } disabled={!isPrimaryEnabled()}>
            {getPrimaryText()}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function VesterDepositModal(props) {
  const { isVisible, setIsVisible, chainId, title, maxAmount, value, setValue,
    balance, escrowedBalance, averageStakedAmount, maxVestableAmount, library,
    stakeTokenLabel, reserveAmount, maxReserveAmount, vesterAddress, setPendingTxns } = props
  const [isDepositing, setIsDepositing] = useState(false)

  let amount = parseValue(value, 18)

  let nextReserveAmount = reserveAmount

  let nextDepositAmount = escrowedBalance
  if (amount) {
    nextDepositAmount = escrowedBalance.add(amount)
  }

  let additionalReserveAmount = bigNumberify(0)
  if (amount && averageStakedAmount && maxVestableAmount && maxVestableAmount.gt(0)) {
    nextReserveAmount = nextDepositAmount.mul(averageStakedAmount).div(maxVestableAmount)
    if (nextReserveAmount.gt(reserveAmount)) {
      additionalReserveAmount = nextReserveAmount.sub(reserveAmount)
    }
  }

  const getError = () => {
    if (!amount || amount.eq(0)) { return "Enter an amount" }
    if (maxAmount && amount.gt(maxAmount)) {
      return "Max amount exceeded"
    }
    if (nextReserveAmount.gt(maxReserveAmount)) {
      return "Insufficient staked tokens"
    }
  }

  const onClickPrimary = () => {
    setIsDepositing(true)
    const contract = new ethers.Contract(vesterAddress, Vester.abi, library.getSigner())

    callContract(chainId, contract, "deposit", [amount], {
      sentMsg: "Deposit submitted!",
      failMsg: "Deposit failed.",
      successMsg: "Deposited!",
      setPendingTxns
    })
    .then(async (res) => {
      setIsVisible(false)
    })
    .finally(() => {
      setIsDepositing(false)
    })
  }

  const isPrimaryEnabled = () => {
    const error = getError()
    if (error) { return false }
    if (isDepositing) { return false }
    return true
  }

  const getPrimaryText = () => {
    const error = getError()
    if (error) { return error }
    if (isDepositing) { return "Depositing..." }
    return "Deposit"
  }

  return (
    <div className="StakeModal">
      <Modal isVisible={isVisible} setIsVisible={setIsVisible} label={title}>
        <div className="Exchange-swap-section">
          <div className="Exchange-swap-section-top">
            <div className="muted">
              <div className="Exchange-swap-usd">
                Deposit
              </div>
            </div>
            <div className="muted align-right clickable" onClick={() => setValue(formatAmountFree(maxAmount, 18, 18))}>Max: {formatAmount(maxAmount, 18, 4, true)}</div>
          </div>
          <div className="Exchange-swap-section-bottom">
            <div>
              <input type="number" placeholder="0.0" className="Exchange-swap-input" value={value} onChange={(e) => setValue(e.target.value)} />
            </div>
            <div className="PositionEditor-token-symbol">
              esGMX
            </div>
          </div>
        </div>
        <div className="VesterDepositModal-info-rows">
          <div className="Exchange-info-row">
            <div className="Exchange-info-label">Wallet</div>
            <div className="align-right">
              {formatAmount(balance, 18, 2, true)} esGMX
            </div>
          </div>
          <div className="Exchange-info-row">
            <div className="Exchange-info-label">Vault Capacity</div>
            <div className="align-right">
              <Tooltip
                handle={`${formatAmount(nextDepositAmount, 18, 2, true)} / ${formatAmount(maxVestableAmount, 18, 2, true)}`}
                position="right-bottom"
                renderContent={() => {
                  return <>
                    Vault Capacity for your Account<br/>
                    <br/>
                    Deposited: {formatAmount(escrowedBalance, 18, 2, true)} esGMX<br/>
                    Max Capacity: {formatAmount(maxVestableAmount, 18, 2, true)} esGMX<br/>
                  </>
                }}
              />
            </div>
          </div>
          <div className="Exchange-info-row">
            <div className="Exchange-info-label">Reserve Amount</div>
            <div className="align-right">
              <Tooltip
                handle={`${formatAmount(nextReserveAmount, 18, 2, true)} / ${formatAmount(maxReserveAmount, 18, 2, true)}`}
                position="right-bottom"
                renderContent={() => {
                  return <>
                    Current Reserved: {formatAmount(reserveAmount, 18, 2, true)}<br/>
                    Reserve Required: {formatAmount(additionalReserveAmount, 18, 2, true)}<br/>
                    {(amount && nextReserveAmount.gt(maxReserveAmount)) && <div><br/>You need a total of at least {formatAmount(nextReserveAmount, 18, 2, true)} {stakeTokenLabel} to vest {formatAmount(amount, 18, 2, true)} esGMX.</div>}
                  </>
                }}
              />
            </div>
          </div>
        </div>
        <div className="Exchange-swap-button-container">
          <button className="App-cta Exchange-swap-button" onClick={ onClickPrimary } disabled={!isPrimaryEnabled()}>
            {getPrimaryText()}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function VesterWithdrawModal(props) {
  const { isVisible, setIsVisible, chainId, title,
    library, vesterAddress, setPendingTxns } = props
  const [isWithdrawing, setIsWithdrawing] = useState(false)

  const onClickPrimary = () => {
    setIsWithdrawing(true)
    const contract = new ethers.Contract(vesterAddress, Vester.abi, library.getSigner())

    callContract(chainId, contract, "withdraw", [], {
      sentMsg: "Withdraw submitted!",
      failMsg: "Withdraw failed.",
      successMsg: "Withdrawn!",
      setPendingTxns
    })
    .then(async (res) => {
      setIsVisible(false)
    })
    .finally(() => {
      setIsWithdrawing(false)
    })

  }

  return (
    <div className="StakeModal">
      <Modal isVisible={isVisible} setIsVisible={setIsVisible} label={title}>
        <div>
          This will withdraw and unreserve all tokens as well as pause vesting.<br/>
          <br/>
          esGMX tokens that have been converted to GMX will remain as GMX tokens.<br/>
          <br/>
          To claim GMX tokens without withdrawing, use the "Claim" button under the Total Rewards section.<br/>
          <br/>
        </div>
        <div className="Exchange-swap-button-container">
          <button className="App-cta Exchange-swap-button" onClick={ onClickPrimary } disabled={isWithdrawing}>
            {!isWithdrawing && "Confirm Withdraw"}
            {isWithdrawing && "Confirming..."}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function CompoundModal(props) {
  const { isVisible, setIsVisible, rewardRouterAddress, active, account, library, chainId, setPendingTxns, totalVesterRewards } = props
  const [isCompounding, setIsCompounding] = useState(false)
	const [shouldClaimGmx, setShouldClaimGmx] = useLocalStorageSerializeKey([chainId, "StakeV2-compound-should-claim-gmx"], true)
	const [shouldStakeGmx, setShouldStakeGmx] = useLocalStorageSerializeKey([chainId, "StakeV2-compound-should-stake-gmx"], true)
	const [shouldClaimEsGmx, setShouldClaimEsGmx] = useLocalStorageSerializeKey([chainId, "StakeV2-compound-should-claim-es-gmx"], true)
	const [shouldStakeEsGmx, setShouldStakeEsGmx] = useLocalStorageSerializeKey([chainId, "StakeV2-compound-should-stake-es-gmx"], true)
	const [shouldStakeMultiplierPoints, setShouldStakeMultiplierPoints] = useLocalStorageSerializeKey([chainId, "StakeV2-compound-should-stake-multiplier-points"], true)
	const [shouldClaimWeth, setShouldClaimWeth] = useLocalStorageSerializeKey([chainId, "StakeV2-compound-should-claim-weth"], true)
	const [shouldConvertWeth, setShouldConvertWeth] = useLocalStorageSerializeKey([chainId, "StakeV2-compound-should-convert-weth"], true)

  const gmxAddress = getContract(chainId, "GMX")
  const stakedGmxTrackerAddress = getContract(chainId, "StakedGmxTracker")

  const [isApproving, setIsApproving] = useState(false)

  const { data: tokenAllowance, mutate: updateTokenAllowance } = useSWR([active, chainId, gmxAddress, "allowance", account, stakedGmxTrackerAddress], {
    fetcher: fetcher(library, Token),
  })

  const needApproval = shouldStakeGmx && tokenAllowance && totalVesterRewards && totalVesterRewards.gt(tokenAllowance)

  useEffect(() => {
    if (active) {
      library.on('block', () => {
        updateTokenAllowance(undefined, true)
      })
      return () => {
        library.removeAllListeners('block')
      }
    }
  }, [active, library, updateTokenAllowance])

  const isPrimaryEnabled = () => {
    return !isCompounding && !isApproving && !isCompounding
  }

  const getPrimaryText = () => {
    if (isApproving) { return `Approving GMX...` }
    if (needApproval) { return `Approve GMX` }
    if (isCompounding) { return "Confirming..." }
    return "Confirm"
  }

  const onClickPrimary = () => {
    if (needApproval) {
      approveTokens({
        setIsApproving,
        library,
        tokenAddress: gmxAddress,
        spender: stakedGmxTrackerAddress,
        chainId
      })
      return
    }

    setIsCompounding(true)

    const contract = new ethers.Contract(rewardRouterAddress, RewardRouter.abi, library.getSigner())
    callContract(chainId, contract, "handleRewards", [
      shouldClaimGmx || shouldStakeGmx,
      shouldStakeGmx,
      shouldClaimEsGmx || shouldStakeEsGmx,
      shouldStakeEsGmx,
      shouldStakeMultiplierPoints,
      shouldClaimWeth || shouldConvertWeth,
      shouldConvertWeth
    ], {
      sentMsg: "Compound submitted!",
      failMsg: "Compound failed.",
      successMsg: "Compound completed.",
      setPendingTxns
    })
    .then(async (res) => {
      setIsVisible(false)
    })
    .finally(() => {
      setIsCompounding(false)
    })
  }

  return (
    <div className="StakeModal">
      <Modal isVisible={isVisible} setIsVisible={setIsVisible} label="Compound Rewards">
        <div className="CompoundModal-menu">
          <div>
  					<Checkbox isChecked={shouldClaimGmx} setIsChecked={setShouldClaimGmx}>
  						Claim GMX Rewards
  					</Checkbox>
          </div>
          <div>
  					<Checkbox isChecked={shouldStakeGmx} setIsChecked={setShouldStakeGmx}>
  						Compound GMX Rewards
  					</Checkbox>
          </div>
          <div>
  					<Checkbox isChecked={shouldClaimEsGmx} setIsChecked={setShouldClaimEsGmx}>
  						Claim esGMX Rewards
  					</Checkbox>
          </div>
          <div>
  					<Checkbox isChecked={shouldStakeEsGmx} setIsChecked={setShouldStakeEsGmx}>
  						Compound esGMX Rewards
  					</Checkbox>
          </div>
          <div>
  					<Checkbox isChecked={shouldStakeMultiplierPoints} setIsChecked={setShouldStakeMultiplierPoints}>
  						Compound Multiplier Points
  					</Checkbox>
          </div>
          <div>
  					<Checkbox isChecked={shouldClaimWeth} setIsChecked={setShouldClaimWeth}>
  						Claim WETH Rewards
  					</Checkbox>
          </div>
          <div>
  					<Checkbox isChecked={shouldConvertWeth} setIsChecked={setShouldConvertWeth}>
  						Convert WETH to ETH
  					</Checkbox>
          </div>
        </div>
        <div className="Exchange-swap-button-container">
          <button className="App-cta Exchange-swap-button" onClick={ onClickPrimary } disabled={!isPrimaryEnabled()}>
            {getPrimaryText()}
          </button>
        </div>
      </Modal>
    </div>
  )
}

function ClaimModal(props) {
  const { isVisible, setIsVisible, rewardRouterAddress, library, chainId, setPendingTxns } = props
  const [isClaiming, setIsClaiming] = useState(false)
	const [shouldClaimGmx, setShouldClaimGmx] = useLocalStorageSerializeKey([chainId, "StakeV2-claim-should-claim-gmx"], true)
	const [shouldClaimEsGmx, setShouldClaimEsGmx] = useLocalStorageSerializeKey([chainId, "StakeV2-claim-should-claim-es-gmx"], true)
	const [shouldClaimWeth, setShouldClaimWeth] = useLocalStorageSerializeKey([chainId, "StakeV2-claim-should-claim-weth"], true)
	const [shouldConvertWeth, setShouldConvertWeth] = useLocalStorageSerializeKey([chainId, "StakeV2-claim-should-convert-weth"], true)

  const isPrimaryEnabled = () => {
    return !isClaiming
  }

  const getPrimaryText = () => {
    if (isClaiming) { return `Claiming...` }
    return "Claim"
  }

  const onClickPrimary = () => {
    setIsClaiming(true)

    const contract = new ethers.Contract(rewardRouterAddress, RewardRouter.abi, library.getSigner())
    callContract(chainId, contract, "handleRewards", [
      shouldClaimGmx,
      false, // shouldStakeGmx
      shouldClaimEsGmx,
      false, // shouldStakeEsGmx
      false, // shouldStakeMultiplierPoints
      shouldClaimWeth,
      shouldConvertWeth
    ], {
      sentMsg: "Claim submitted!",
      failMsg: "Claim failed.",
      successMsg: "Claim completed.",
      setPendingTxns
    })
    .then(async (res) => {
      setIsVisible(false)
    })
    .finally(() => {
      setIsClaiming(false)
    })
  }

  return (
    <div className="StakeModal">
      <Modal isVisible={isVisible} setIsVisible={setIsVisible} label="Claim Rewards">
        <div className="CompoundModal-menu">
          <div>
  					<Checkbox isChecked={shouldClaimGmx} setIsChecked={setShouldClaimGmx}>
  						Claim GMX Rewards
  					</Checkbox>
          </div>
          <div>
  					<Checkbox isChecked={shouldClaimEsGmx} setIsChecked={setShouldClaimEsGmx}>
  						Claim esGMX Rewards
  					</Checkbox>
          </div>
          <div>
  					<Checkbox isChecked={shouldClaimWeth} setIsChecked={setShouldClaimWeth}>
  						Claim WETH Rewards
  					</Checkbox>
          </div>
          <div>
  					<Checkbox isChecked={shouldConvertWeth} setIsChecked={setShouldConvertWeth}>
  						Convert WETH to ETH
  					</Checkbox>
          </div>
        </div>
        <div className="Exchange-swap-button-container">
          <button className="App-cta Exchange-swap-button" onClick={ onClickPrimary } disabled={!isPrimaryEnabled()}>
            {getPrimaryText()}
          </button>
        </div>
      </Modal>
    </div>
  )
}

export default function StakeV2({ setPendingTxns, connectWallet }) {
  const { active, library, account } = useWeb3React()
  const chainId = 42161 // set chain to Arbitrum

  const [isBuyGmxModalVisible, setIsBuyGmxModalVisible] = useState(false)
  const [isStakeModalVisible, setIsStakeModalVisible] = useState(false)
  const [stakeModalTitle, setStakeModalTitle] = useState("")
  const [stakeModalMaxAmount, setStakeModalMaxAmount] = useState(undefined)
  const [stakeValue, setStakeValue] = useState("")
  const [stakingTokenSymbol, setStakingTokenSymbol] = useState("")
  const [stakingTokenAddress, setStakingTokenAddress] = useState("")
  const [stakingFarmAddress, setStakingFarmAddress] = useState("")
  const [stakeMethodName, setStakeMethodName] = useState("")

  const [isUnstakeModalVisible, setIsUnstakeModalVisible] = useState(false)
  const [unstakeModalTitle, setUnstakeModalTitle] = useState("")
  const [unstakeModalMaxAmount, setUnstakeModalMaxAmount] = useState(undefined)
  const [unstakeModalReservedAmount, setUnstakeModalReservedAmount] = useState(undefined)
  const [unstakeValue, setUnstakeValue] = useState("")
  const [unstakingTokenSymbol, setUnstakingTokenSymbol] = useState("")
  const [unstakeMethodName, setUnstakeMethodName] = useState("")

  const [isVesterDepositModalVisible, setIsVesterDepositModalVisible] = useState(false)
  const [vesterDepositTitle, setVesterDepositTitle] = useState("")
  const [vesterDepositStakeTokenLabel, setVesterDepositStakeTokenLabel] = useState("")
  const [vesterDepositMaxAmount, setVesterDepositMaxAmount] = useState("")
  const [vesterDepositBalance, setVesterDepositBalance] = useState("")
  const [vesterDepositEscrowedBalance, setVesterDepositEscrowedBalance] = useState("")
  const [vesterDepositAverageStakedAmount, setVesterDepositAverageStakedAmount] = useState("")
  const [vesterDepositMaxVestableAmount, setVesterDepositMaxVestableAmount] = useState("")
  const [vesterDepositValue, setVesterDepositValue] = useState("")
  const [vesterDepositReserveAmount, setVesterDepositReserveAmount] = useState("")
  const [vesterDepositMaxReserveAmount, setVesterDepositMaxReserveAmount] = useState("")
  const [vesterDepositAddress, setVesterDepositAddress] = useState("")

  const [isVesterWithdrawModalVisible, setIsVesterWithdrawModalVisible] = useState(false)
  const [vesterWithdrawTitle, setVesterWithdrawTitle] = useState(false)
  const [vesterWithdrawAddress, setVesterWithdrawAddress] = useState("")

  const [isCompoundModalVisible, setIsCompoundModalVisible] = useState(false)
  const [isClaimModalVisible, setIsClaimModalVisible] = useState(false)

  const rewardRouterAddress = getContract(chainId, "RewardRouter")
  const rewardReaderAddress = getContract(chainId, "RewardReader")
  const readerAddress = getContract(chainId, "Reader")

  const vaultAddress = getContract(chainId, "Vault")
  const nativeTokenAddress = getContract(chainId, "NATIVE_TOKEN")
  const gmxAddress = getContract(chainId, "GMX")
  const esGmxAddress = getContract(chainId, "ES_GMX")
  const bnGmxAddress = getContract(chainId, "BN_GMX")
  const glpAddress = getContract(chainId, "GLP")

  const stakedGmxTrackerAddress = getContract(chainId, "StakedGmxTracker")
  const bonusGmxTrackerAddress = getContract(chainId, "BonusGmxTracker")
  const feeGmxTrackerAddress = getContract(chainId, "FeeGmxTracker")

  const stakedGlpTrackerAddress = getContract(chainId, "StakedGlpTracker")
  const feeGlpTrackerAddress = getContract(chainId, "FeeGlpTracker")

  const glpManagerAddress = getContract(chainId, "GlpManager")

  const stakedGmxDistributorAddress = getContract(chainId, "StakedGmxDistributor")
  const stakedGlpDistributorAddress = getContract(chainId, "StakedGlpDistributor")

  const gmxVesterAddress = getContract(chainId, "GmxVester")
  const glpVesterAddress = getContract(chainId, "GlpVester")

  const vesterAddresses = [gmxVesterAddress, glpVesterAddress]

  const excludedEsGmxAccounts = [stakedGmxDistributorAddress, stakedGlpDistributorAddress]

  const walletTokens = [gmxAddress, esGmxAddress, glpAddress, stakedGmxTrackerAddress]
  const depositTokens = [
    gmxAddress,
    esGmxAddress,
    stakedGmxTrackerAddress,
    bonusGmxTrackerAddress,
    bnGmxAddress,
    glpAddress
  ]
  const rewardTrackersForDepositBalances = [
    stakedGmxTrackerAddress,
    stakedGmxTrackerAddress,
    bonusGmxTrackerAddress,
    feeGmxTrackerAddress,
    feeGmxTrackerAddress,
    feeGlpTrackerAddress
  ]
  const rewardTrackersForStakingInfo = [
    stakedGmxTrackerAddress,
    bonusGmxTrackerAddress,
    feeGmxTrackerAddress,
    stakedGlpTrackerAddress,
    feeGlpTrackerAddress
  ]

  const { data: walletBalances, mutate: updateWalletBalances } = useSWR(["StakeV2:walletBalances", chainId, readerAddress, "getTokenBalancesWithSupplies", account || AddressZero], {
    fetcher: fetcher(library, ReaderV2, [walletTokens]),
  })

  const { data: depositBalances, mutate: updateDepositBalances } = useSWR(["StakeV2:depositBalances", chainId, rewardReaderAddress, "getDepositBalances", account || AddressZero], {
    fetcher: fetcher(library, RewardReader, [depositTokens, rewardTrackersForDepositBalances]),
  })

  const { data: stakingInfo, mutate: updateStakingInfo } = useSWR(["StakeV2:stakingInfo", chainId, rewardReaderAddress, "getStakingInfo", account || AddressZero], {
    fetcher: fetcher(library, RewardReader, [rewardTrackersForStakingInfo]),
  })

  const { data: stakedGmxSupply, mutate: updateStakedGmxSupply } = useSWR(["StakeV2:stakedGmxSupply", chainId, gmxAddress, "balanceOf", stakedGmxTrackerAddress], {
    fetcher: fetcher(library, Token),
  })

  const { data: aums, mutate: updateAums } = useSWR([`StakeV2:getAums:${active}`, chainId, glpManagerAddress, "getAums"], {
    fetcher: fetcher(library, GlpManager),
  })

  const { data: nativeTokenPrice, mutate: updateNativeTokenPrice } = useSWR([`StakeV2:nativeTokenPrice:${active}`, chainId, vaultAddress, "getMinPrice", nativeTokenAddress], {
    fetcher: fetcher(library, Vault),
  })

  const { data: esGmxSupply, mutate: updateEsGmxSupply } = useSWR([`StakeV2:esGmxSupply:${active}`, chainId, readerAddress, "getTokenSupply", esGmxAddress], {
    fetcher: fetcher(library, ReaderV2, [excludedEsGmxAccounts]),
  })

  const { data: vestingInfo, mutate: updateVestingInfo } = useSWR([`StakeV2:vestingInfo:${active}`, chainId, readerAddress, "getVestingInfo", account || AddressZero], {
    fetcher: fetcher(library, ReaderV2, [vesterAddresses]),
  })

  const poolAddress = "0x80A9ae39310abf666A87C743d6ebBD0E8C42158E" // GMX/WETH

  const { data: uniPoolSlot0, mutate: updateUniPoolSlot0 } = useSWR([`StakeV2:uniPoolSlot0:${active}`, chainId, poolAddress, "slot0"], {
    fetcher: fetcher(library, UniPool),
  })

  const gmxSupplyUrl = getServerUrl(chainId, "/gmx_supply")
  const { data: gmxSupply, mutate: updateGmxSupply } = useSWR([gmxSupplyUrl], {
    fetcher: (...args) => fetch(...args).then(res => res.text())
  })

  const isGmxTransferEnabled = true

  let gmxPrice
  if (isGmxTransferEnabled) {
    if (uniPoolSlot0 && nativeTokenPrice) {
      const tokenA = new UniToken(chainId, nativeTokenAddress, 18, "SYMBOL", "NAME")
      const tokenB = new UniToken(chainId, gmxAddress, 18, "SYMBOL", "NAME")

      const pool = new Pool(
        tokenA, // tokenA
        tokenB, // tokenB
        10000, // fee
        uniPoolSlot0.sqrtPriceX96, // sqrtRatioX96
        1, // liquidity
        uniPoolSlot0.tick, // tickCurrent
        []
      )

      const poolTokenPrice = pool.priceOf(tokenB).toSignificant(6)
      const poolTokenPriceAmount = parseValue(poolTokenPrice, 18)
      gmxPrice = poolTokenPriceAmount.mul(nativeTokenPrice).div(expandDecimals(1, 18))
    }
  }

  let esGmxSupplyUsd
  if (esGmxSupply && gmxPrice) {
    esGmxSupplyUsd = esGmxSupply.mul(gmxPrice).div(expandDecimals(1, 18))
  }

  let aum
  if (aums && aums.length > 0) {
    aum = aums[0].add(aums[1]).div(2)
  }

  const { balanceData, supplyData } = getBalanceAndSupplyData(walletBalances)
  const depositBalanceData = getDepositBalanceData(depositBalances)
  const stakingData = getStakingData(stakingInfo)
  const vestingData = getVestingData(vestingInfo)

  const processedData = getProcessedData(balanceData, supplyData, depositBalanceData, stakingData, vestingData, aum, nativeTokenPrice, stakedGmxSupply, gmxPrice, gmxSupply)

  let hasMultiplierPoints = false
  let multiplierPointsAmount
  if (processedData && processedData.bonusGmxTrackerRewards && processedData.bnGmxInFeeGmx) {
    multiplierPointsAmount = processedData.bonusGmxTrackerRewards.add(processedData.bnGmxInFeeGmx)
    if (multiplierPointsAmount.gt(0)) {
      hasMultiplierPoints = true
    }
  }
  let totalRewardTokens
  if (processedData && processedData.bnGmxInFeeGmx && processedData.bonusGmxInFeeGmx) {
    totalRewardTokens = processedData.bnGmxInFeeGmx.add(processedData.bonusGmxInFeeGmx)
  }

  let totalRewardTokensAndGlp
  if (totalRewardTokens && processedData && processedData.glpBalance) {
    totalRewardTokensAndGlp = totalRewardTokens.add(processedData.glpBalance)
  }

  const bonusGmxInFeeGmx = processedData ? processedData.bonusGmxInFeeGmx : undefined

  let boostBasisPoints = bigNumberify(0)
  if (processedData && processedData.bnGmxInFeeGmx && processedData.bonusGmxInFeeGmx && processedData.bonusGmxInFeeGmx.gt(0)) {
    boostBasisPoints = processedData.bnGmxInFeeGmx.mul(BASIS_POINTS_DIVISOR).div(processedData.bonusGmxInFeeGmx)
  }

  let stakedGmxSupplyUsd
  if (stakedGmxSupply && gmxPrice) {
    stakedGmxSupplyUsd = stakedGmxSupply.mul(gmxPrice).div(expandDecimals(1, 18))
  }

  let maxUnstakeableGmx = bigNumberify(0)
  if (totalRewardTokens && vestingData && vestingData.gmxVesterPairAmount &&
      multiplierPointsAmount && processedData.bonusGmxInFeeGmx) {
    const availableTokens = totalRewardTokens.sub(vestingData.gmxVesterPairAmount)
    const stakedTokens = processedData.bonusGmxInFeeGmx
    const divisor = multiplierPointsAmount.add(stakedTokens)
    if (divisor.gt(0)) {
      maxUnstakeableGmx = availableTokens.mul(stakedTokens).div(divisor)
    }
  }

  useEffect(() => {
    if (active) {
      library.on('block', () => {
        updateWalletBalances(undefined, true)
        updateDepositBalances(undefined, true)
        updateStakingInfo(undefined, true)
        updateAums(undefined, true)
        updateNativeTokenPrice(undefined, true)
        updateStakedGmxSupply(undefined, true)
        updateEsGmxSupply(undefined, true)
        updateUniPoolSlot0(undefined, true)
        updateVestingInfo(undefined, true)
        updateGmxSupply(undefined, true)
      })
      return () => {
        library.removeAllListeners('block')
      }
    }
  }, [library, active, updateWalletBalances, updateDepositBalances,
      updateStakingInfo, updateAums, updateNativeTokenPrice,
      updateStakedGmxSupply, updateEsGmxSupply, updateUniPoolSlot0,
      updateVestingInfo, updateGmxSupply])

  const showStakeGmxModal = () => {
    if (!isGmxTransferEnabled) {
      helperToast.error("GMX transfers not yet enabled")
      return
    }

    setIsStakeModalVisible(true)
    setStakeModalTitle("Stake GMX")
    setStakeModalMaxAmount(processedData.gmxBalance)
    setStakeValue("")
    setStakingTokenSymbol("GMX")
    setStakingTokenAddress(gmxAddress)
    setStakingFarmAddress(stakedGmxTrackerAddress)
    setStakeMethodName("stakeGmx")
  }

  const showStakeEsGmxModal = () => {
    setIsStakeModalVisible(true)
    setStakeModalTitle("Stake esGMX")
    setStakeModalMaxAmount(processedData.esGmxBalance)
    setStakeValue("")
    setStakingTokenSymbol("esGMX")
    setStakingTokenAddress(esGmxAddress)
    setStakingFarmAddress(AddressZero)
    setStakeMethodName("stakeEsGmx")
  }

  const showGmxVesterDepositModal = () => {
    let remainingVestableAmount = vestingData.gmxVester.maxVestableAmount.sub(vestingData.gmxVester.vestedAmount)
    if (processedData.esGmxBalance.lt(remainingVestableAmount)) {
      remainingVestableAmount = processedData.esGmxBalance
    }

    setIsVesterDepositModalVisible(true)
    setVesterDepositTitle("GMX Vault")
    setVesterDepositStakeTokenLabel("staked GMX + esGMX + Multiplier Points")
    setVesterDepositMaxAmount(remainingVestableAmount)
    setVesterDepositBalance(processedData.esGmxBalance)
    setVesterDepositEscrowedBalance(vestingData.gmxVester.escrowedBalance)
    setVesterDepositMaxVestableAmount(vestingData.gmxVester.maxVestableAmount)
    setVesterDepositAverageStakedAmount(vestingData.gmxVester.averageStakedAmount)
    setVesterDepositReserveAmount(vestingData.gmxVester.pairAmount)
    setVesterDepositMaxReserveAmount(totalRewardTokens)
    setVesterDepositValue("")
    setVesterDepositAddress(gmxVesterAddress)
  }

  const showGlpVesterDepositModal = () => {
    let remainingVestableAmount = vestingData.glpVester.maxVestableAmount.sub(vestingData.glpVester.vestedAmount)
    if (processedData.esGmxBalance.lt(remainingVestableAmount)) {
      remainingVestableAmount = processedData.esGmxBalance
    }

    setIsVesterDepositModalVisible(true)
    setVesterDepositTitle("GLP Vault")
    setVesterDepositStakeTokenLabel("staked GLP")
    setVesterDepositMaxAmount(remainingVestableAmount)
    setVesterDepositBalance(processedData.esGmxBalance)
    setVesterDepositEscrowedBalance(vestingData.glpVester.escrowedBalance)
    setVesterDepositMaxVestableAmount(vestingData.glpVester.maxVestableAmount)
    setVesterDepositAverageStakedAmount(vestingData.glpVester.averageStakedAmount)
    setVesterDepositReserveAmount(vestingData.glpVester.pairAmount)
    setVesterDepositMaxReserveAmount(processedData.glpBalance)
    setVesterDepositValue("")
    setVesterDepositAddress(glpVesterAddress)
  }

  const showGmxVesterWithdrawModal = () => {
    setIsVesterWithdrawModalVisible(true)
    setVesterWithdrawTitle("Withdraw from GMX Vault")
    setVesterWithdrawAddress(gmxVesterAddress)
  }

  const showGlpVesterWithdrawModal = () => {
    setIsVesterWithdrawModalVisible(true)
    setVesterWithdrawTitle("Withdraw from GLP Vault")
    setVesterWithdrawAddress(glpVesterAddress)
  }

  const showUnstakeGmxModal = () => {
    if (!isGmxTransferEnabled) {
      helperToast.error("GMX transfers not yet enabled")
      return
    }
    setIsUnstakeModalVisible(true)
    setUnstakeModalTitle("Unstake GMX")
    let maxAmount = processedData.gmxInStakedGmx
    if (processedData.gmxInStakedGmx && vestingData && vestingData.gmxVesterPairAmount.gt(0) && maxUnstakeableGmx && maxUnstakeableGmx.lt(processedData.gmxInStakedGmx)) {
      maxAmount = maxUnstakeableGmx
    }
    setUnstakeModalMaxAmount(maxAmount)
    setUnstakeModalReservedAmount(vestingData.gmxVesterPairAmount)
    setUnstakeValue("")
    setUnstakingTokenSymbol("GMX")
    setUnstakeMethodName("unstakeGmx")
  }

  const showUnstakeEsGmxModal = () => {
    setIsUnstakeModalVisible(true)
    setUnstakeModalTitle("Unstake esGMX")
    let maxAmount = processedData.esGmxInStakedGmx
    if (processedData.esGmxInStakedGmx && vestingData && vestingData.gmxVesterPairAmount.gt(0) && maxUnstakeableGmx && maxUnstakeableGmx.lt(processedData.esGmxInStakedGmx)) {
      maxAmount = maxUnstakeableGmx
    }
    setUnstakeModalMaxAmount(maxAmount)
    setUnstakeModalReservedAmount(vestingData.gmxVesterPairAmount)
    setUnstakeValue("")
    setUnstakingTokenSymbol("esGMX")
    setUnstakeMethodName("unstakeEsGmx")
  }

  const renderMultiplierPointsLabel = useCallback(() => {
    return "Multiplier Points APR"
  }, [])

  const renderMultiplierPointsValue = useCallback(() => {
    return (
      <Tooltip handle={`100.00%`} position="right-bottom" renderContent={() => {
        return <>
          Boost your rewards with Multiplier Points.&nbsp;
          <a href="https://gmxio.gitbook.io/gmx/rewards#multiplier-points" rel="noreferrer" target="_blank">More info</a>.
        </>
        }}
      />
    )
  }, [])

  let earnMsg
  if (totalRewardTokens && totalRewardTokens.gt(0)) {
    let gmxAmountStr
    if (processedData.gmxInStakedGmx && processedData.gmxInStakedGmx.gt(0)) {
      gmxAmountStr = formatAmount(processedData.gmxInStakedGmx, 18, 2, true) + " GMX"
    }
    let esGmxAmountStr
    if (processedData.esGmxInStakedGmx && processedData.esGmxInStakedGmx.gt(0)) {
      esGmxAmountStr = formatAmount(processedData.esGmxInStakedGmx, 18, 2, true) + " esGMX"
    }
    let mpAmountStr
    if (processedData.bonusGmxInFeeGmx && processedData.bnGmxInFeeGmx.gt(0)) {
      mpAmountStr = formatAmount(processedData.bnGmxInFeeGmx, 18, 2, true) + " MP"
    }
    let glpStr
    if (processedData.glpBalance && processedData.glpBalance.gt(0)) {
      glpStr = formatAmount(processedData.glpBalance, 18, 2, true) + " GLP"
    }
    const amountStr = [gmxAmountStr, esGmxAmountStr, mpAmountStr, glpStr].filter(s => s).join(", ")
    earnMsg = <div>You are earning ETH rewards with {formatAmount(totalRewardTokensAndGlp, 18, 2, true)} tokens.<br/>Tokens: {amountStr}.</div>
  }

  const onNetworkClick = evt => {
    evt.preventDefault()
    switchNetwork(ARBITRUM)
  }

  return (
    <div className="StakeV2 Page">
      <StakeModal
        isVisible={isStakeModalVisible}
        setIsVisible={setIsStakeModalVisible}
        chainId={chainId}
        title={stakeModalTitle}
        maxAmount={stakeModalMaxAmount}
        value={stakeValue}
        setValue={setStakeValue}
        active={active}
        account={account}
        library={library}
        stakingTokenSymbol={stakingTokenSymbol}
        stakingTokenAddress={stakingTokenAddress}
        farmAddress={stakingFarmAddress}
        rewardRouterAddress={rewardRouterAddress}
        stakeMethodName={stakeMethodName}
        hasMultiplierPoints={hasMultiplierPoints}
        setPendingTxns={setPendingTxns}
      />
      <UnstakeModal
        setPendingTxns={setPendingTxns}
        isVisible={isUnstakeModalVisible}
        setIsVisible={setIsUnstakeModalVisible}
        chainId={chainId}
        title={unstakeModalTitle}
        maxAmount={unstakeModalMaxAmount}
        reservedAmount={unstakeModalReservedAmount}
        value={unstakeValue}
        setValue={setUnstakeValue}
        library={library}
        unstakingTokenSymbol={unstakingTokenSymbol}
        rewardRouterAddress={rewardRouterAddress}
        unstakeMethodName={unstakeMethodName}
        multiplierPointsAmount={multiplierPointsAmount}
        bonusGmxInFeeGmx={bonusGmxInFeeGmx}
      />
      <VesterDepositModal
        isVisible={isVesterDepositModalVisible}
        setIsVisible={setIsVesterDepositModalVisible}
        chainId={chainId}
        title={vesterDepositTitle}
        stakeTokenLabel={vesterDepositStakeTokenLabel}
        maxAmount={vesterDepositMaxAmount}
        balance={vesterDepositBalance}
        escrowedBalance={vesterDepositEscrowedBalance}
        averageStakedAmount={vesterDepositAverageStakedAmount}
        maxVestableAmount={vesterDepositMaxVestableAmount}
        reserveAmount={vesterDepositReserveAmount}
        maxReserveAmount={vesterDepositMaxReserveAmount}
        value={vesterDepositValue}
        setValue={setVesterDepositValue}
        library={library}
        vesterAddress={vesterDepositAddress}
        setPendingTxns={setPendingTxns}
      />
      <VesterWithdrawModal
        isVisible={isVesterWithdrawModalVisible}
        setIsVisible={setIsVesterWithdrawModalVisible}
        vesterAddress={vesterWithdrawAddress}
        chainId={chainId}
        title={vesterWithdrawTitle}
        library={library}
        setPendingTxns={setPendingTxns}
      />
      <CompoundModal
        active={active}
        account={account}
        setPendingTxns={setPendingTxns}
        isVisible={isCompoundModalVisible}
        setIsVisible={setIsCompoundModalVisible}
        rewardRouterAddress={rewardRouterAddress}
        totalVesterRewards={processedData.totalVesterRewards}
        library={library}
        chainId={chainId}
      />
      <ClaimModal
        active={active}
        account={account}
        setPendingTxns={setPendingTxns}
        isVisible={isClaimModalVisible}
        setIsVisible={setIsClaimModalVisible}
        rewardRouterAddress={rewardRouterAddress}
        totalVesterRewards={processedData.totalVesterRewards}
        library={library}
        chainId={chainId}
      />
      <Modal isVisible={isBuyGmxModalVisible} setIsVisible={setIsBuyGmxModalVisible} className="StakeV2-buy-gmx-modal" label="To Buy GMX">
        <p>
          1. Transfer ETH to Arbitrum using the <a href="https://bridge.arbitrum.io/" target="_blank" rel="noreferrer">Arbitrum Bridge</a>.
        </p>
        <p>
          2. <a href="/" onClick={onNetworkClick}>Click here</a> to ensure your wallet is connected to the Arbitrum network.
        </p>
        <p>
          3. Buy GMX on <a href="https://app.uniswap.org/#/swap?inputCurrency=ETH&outputCurrency=0xfc5A1A6EB076a2C7aD06eD22C90d7E710E35ad0a" target="_blank" rel="noreferrer">Uniswap</a>.
        </p>
        <p>
          For more info: <a href="https://gmxio.gitbook.io/gmx/tokenomics" target="_blank" rel="noreferrer">https://gmxio.gitbook.io/gmx/tokenomics</a>.
        </p>
      </Modal>
      <div className="Page-title-section">
        <div className="Page-title">Earn</div>
        <div className="Page-description">
          Stake <a href="https://gmxio.gitbook.io/gmx/tokenomics" target="_blank" rel="noopener noreferrer">
            GMX
          </a> and <a href="https://gmxio.gitbook.io/gmx/glp" target="_blank" rel="noopener noreferrer">
            GLP
          </a> to earn rewards.
        </div>
        {earnMsg && <div className="Page-description">{earnMsg}</div>}
      </div>
      <div className="StakeV2-content">
        <div className="StakeV2-cards">
          <div className="App-card StakeV2-gmx-card">
            <div className="App-card-title">GMX</div>
            <div className="App-card-divider"></div>
            <div className="App-card-content">
              <div className="App-card-row">
                <div className="label">Price</div>
                <div>
                  ${formatAmount(gmxPrice, USD_DECIMALS, 2, true)}
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Wallet</div>
                <div>
                  {formatKeyAmount(processedData, "gmxBalance", 18, 2, true)} GMX (${formatKeyAmount(processedData, "gmxBalanceUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Staked</div>
                <div>
                  {formatKeyAmount(processedData, "gmxInStakedGmx", 18, 2, true)} GMX (${formatKeyAmount(processedData, "gmxInStakedGmxUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-row">
                <div className="label">APR</div>
                <div>
                  <Tooltip
                    handle={`${formatKeyAmount(processedData, "gmxAprTotal", 2, 2, true)}%`}
                    position="right-bottom"
                    renderContent={() => {
                      return <>
                        <div className="Tooltip-row">
                          <span className="label">ETH (WETH) APR</span>
                          <span>{formatKeyAmount(processedData, "gmxAprForETH", 2, 2, true)}%</span>
                        </div>
                        <div className="Tooltip-row">
                          <span className="label">Escrowed GMX APR</span>
                          <span>{formatKeyAmount(processedData, "gmxAprForEsGmx", 2, 2, true)}%</span>
                        </div>
                      </>
                    }}
                  />
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Rewards</div>
                <div>
                  <Tooltip
                    handle={`$${formatKeyAmount(processedData, "totalGmxRewardsUsd", USD_DECIMALS, 2, true)}`}
                    position="right-bottom"
                    renderContent={() => {
                      return <>
                        <div className="Tooltip-row">
                          <span className="label">ETH (WETH)</span>
                          <span>{formatKeyAmount(processedData, "feeGmxTrackerRewards", 18, 4)} (${formatKeyAmount(processedData, "feeGmxTrackerRewardsUsd", USD_DECIMALS, 2, true)})</span>
                        </div>
                        <div className="Tooltip-row">
                          <span className="label">Escrowed GMX</span>
                          <span>{formatKeyAmount(processedData, "stakedGmxTrackerRewards", 18, 4)} (${formatKeyAmount(processedData, "stakedGmxTrackerRewardsUsd", USD_DECIMALS, 2, true)})</span>
                        </div>
                      </>
                    }}
                  />
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">
                  {renderMultiplierPointsLabel()}
                </div>
                <div>
                  {renderMultiplierPointsValue()}
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">
                  Boost Percentage
                </div>
                <div>
                  <Tooltip
                    handle={`${formatAmount(boostBasisPoints, 2, 2, false)}%`}
                    position="right-bottom"
                    renderContent={() => {
                      return <>
                        You are earning {formatAmount(boostBasisPoints, 2, 2, false)}% more ETH rewards using {formatAmount(processedData.bnGmxInFeeGmx, 18, 4, 2, true)} Staked Multiplier Points.<br/>
                        <br/>
                        Use the "Compound" button to stake your Multiplier Points.
                      </>
                    }}
                  />
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-row">
                <div className="label">Total Staked</div>
                <div>
                  {formatAmount(stakedGmxSupply, 18, 0, true)} GMX (${formatAmount(stakedGmxSupplyUsd, USD_DECIMALS, 0, true)})
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Total Supply</div>
                <div>
                  {formatKeyAmount(processedData, "gmxSupply", 18, 0, true)} GMX (${formatKeyAmount(processedData, "gmxSupplyUsd", USD_DECIMALS, 0, true)})
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-options">
                <button className="App-button-option App-card-option" onClick={() => setIsBuyGmxModalVisible(true)}>Buy GMX</button>
                {active && <button className="App-button-option App-card-option" onClick={() => showStakeGmxModal()}>Stake</button>}
                {active && <button className="App-button-option App-card-option" onClick={() => showUnstakeGmxModal()}>Unstake</button>}
                {active && <Link className="App-button-option App-card-option" to="/begin_account_transfer">Transfer</Link>}
              </div>
            </div>
          </div>
          <div className="App-card primary StakeV2-total-rewards-card">
            <div className="App-card-title">Total Rewards</div>
            <div className="App-card-divider"></div>
            <div className="App-card-content">
              <div className="App-card-row">
                <div className="label">ETH (WETH)</div>
                <div>
                  {formatKeyAmount(processedData, "totalETHRewards", 18, 4, true)} (${formatKeyAmount(processedData, "totalETHRewardsUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">GMX</div>
                <div>
                  {formatKeyAmount(processedData, "totalVesterRewards", 18, 4, true)} (${formatKeyAmount(processedData, "totalVesterRewardsUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Escrowed GMX</div>
                <div>
                  {formatKeyAmount(processedData, "totalEsGmxRewards", 18, 4, true)} (${formatKeyAmount(processedData, "totalEsGmxRewardsUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Multiplier Points</div>
                <div>
                  {formatKeyAmount(processedData, "bonusGmxTrackerRewards", 18, 4, true)}
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Staked Multiplier Points</div>
                <div>
                  {formatKeyAmount(processedData, "bnGmxInFeeGmx", 18, 4, true)}
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Total</div>
                <div>
                  ${formatKeyAmount(processedData, "totalRewardsUsd", USD_DECIMALS, 2, true)}
                </div>
              </div>
              <div className="App-card-bottom-placeholder">
                <div className="App-card-divider"></div>
                <div className="App-card-options">
                  {active && <button className="App-button-option App-card-option">Compound</button>}
                  {active && <button className="App-button-option App-card-option">Claim</button>}
                  {!active && <button className="App-button-option App-card-option" onClick={() => connectWallet()}>Connect Wallet</button>}
                </div>
              </div>
              <div className="App-card-bottom">
                <div className="App-card-divider"></div>
                <div className="App-card-options">
                  {active && <button className="App-button-option App-card-option" onClick={() => setIsCompoundModalVisible(true)}>Compound</button>}
                  {active && <button className="App-button-option App-card-option" onClick={() => setIsClaimModalVisible(true)}>Claim</button>}
                  {!active && <button className="App-button-option App-card-option" onClick={() => connectWallet()}>Connect Wallet</button>}
                </div>
              </div>
            </div>
          </div>
          <div className="App-card">
            <div className="App-card-title">GLP</div>
            <div className="App-card-divider"></div>
            <div className="App-card-content">
              <div className="App-card-row">
                <div className="label">Price</div>
                <div>
                  ${formatKeyAmount(processedData, "glpPrice", USD_DECIMALS, 2, true)}
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Wallet</div>
                <div>
                  {formatKeyAmount(processedData, "glpBalance", GLP_DECIMALS, 2, true)} GLP (${formatKeyAmount(processedData, "glpBalanceUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Staked</div>
                <div>
                  {formatKeyAmount(processedData, "glpBalance", GLP_DECIMALS, 2, true)} GLP (${formatKeyAmount(processedData, "glpBalanceUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-row">
                <div className="label">APR</div>
                <div>
                  <Tooltip
                    handle={`${formatKeyAmount(processedData, "glpAprTotal", 2, 2, true)}%`}
                    position="right-bottom"
                    renderContent={() => {
                      return <>
                        <div className="Tooltip-row">
                          <span className="label">ETH (WETH) APR</span>
                          <span>{formatKeyAmount(processedData, "glpAprForETH", 2, 2, true)}%</span>
                        </div>
                        <div className="Tooltip-row">
                          <span className="label">Escrowed GMX APR</span>
                          <span>{formatKeyAmount(processedData, "glpAprForEsGmx", 2, 2, true)}%</span>
                        </div>
                      </>
                    }}
                  />
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Rewards</div>
                <div>
                  <Tooltip
                    handle={`$${formatKeyAmount(processedData, "totalGlpRewardsUsd", USD_DECIMALS, 2, true)}`}
                    position="right-bottom"
                    renderContent={() => {
                      return <>
                        <div className="Tooltip-row">
                          <span className="label">ETH (WETH)</span>
                          <span>{formatKeyAmount(processedData, "feeGlpTrackerRewards", 18, 4)} (${formatKeyAmount(processedData, "feeGlpTrackerRewardsUsd", USD_DECIMALS, 2, true)})</span>
                        </div>
                        <div className="Tooltip-row">
                          <span className="label">Escrowed GMX</span>
                          <span>{formatKeyAmount(processedData, "stakedGlpTrackerRewards", 18, 4)} (${formatKeyAmount(processedData, "stakedGlpTrackerRewardsUsd", USD_DECIMALS, 2, true)})</span>
                        </div>
                      </>
                    }}
                  />
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-row">
                <div className="label">Total Staked</div>
                <div>
                  {formatKeyAmount(processedData, "glpSupply", 18, 2, true)} GLP (${formatKeyAmount(processedData, "glpSupplyUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Total Supply</div>
                <div>
                  {formatKeyAmount(processedData, "glpSupply", 18, 2, true)} GLP (${formatKeyAmount(processedData, "glpSupplyUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-options">
                <Link className="App-button-option App-card-option" to="/buy_glp">Buy GLP</Link>
                <Link className="App-button-option App-card-option" to="/sell_glp">Sell GLP</Link>
              </div>
            </div>
          </div>
          <div className="App-card">
            <div className="App-card-title">Escrowed GMX</div>
            <div className="App-card-divider"></div>
            <div className="App-card-content">
              <div className="App-card-row">
                <div className="label">Price</div>
                <div>
                  ${formatAmount(gmxPrice, USD_DECIMALS, 2, true)}
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Wallet</div>
                <div>
                  {formatKeyAmount(processedData, "esGmxBalance", 18, 2, true)} esGMX (${formatKeyAmount(processedData, "esGmxBalanceUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Staked</div>
                <div>
                  {formatKeyAmount(processedData, "esGmxInStakedGmx", 18, 2, true)} esGMX (${formatKeyAmount(processedData, "esGmxInStakedGmxUsd", USD_DECIMALS, 2, true)})
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-row">
                <div className="label">APR</div>
                <div>
                  <div>
                    <Tooltip
                      handle={`${formatKeyAmount(processedData, "gmxAprTotal", 2, 2, true)}%`}
                      position="right-bottom"
                      renderContent={() => {
                        return <>
                          <div className="Tooltip-row">
                            <span className="label">ETH (WETH) APR</span>
                            <span>{formatKeyAmount(processedData, "gmxAprForETH", 2, 2, true)}%</span>
                          </div>
                          <div className="Tooltip-row">
                            <span className="label">Escrowed GMX APR</span>
                            <span>{formatKeyAmount(processedData, "gmxAprForEsGmx", 2, 2, true)}%</span>
                          </div>
                        </>
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">
                  {renderMultiplierPointsLabel()}
                </div>
                <div>
                  {renderMultiplierPointsValue()}
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-row">
                <div className="label">Total Staked</div>
                <div>
                  {formatKeyAmount(processedData, "stakedEsGmxSupply", 18, 0, true)} esGMX (${formatKeyAmount(processedData, "stakedEsGmxSupplyUsd", USD_DECIMALS, 0, true)})
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Total Supply</div>
                <div>
                  {formatAmount(esGmxSupply, 18, 0, true)} esGMX (${formatAmount(esGmxSupplyUsd, USD_DECIMALS, 0, true)})
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-options">
                {active && <button className="App-button-option App-card-option" onClick={() => showStakeEsGmxModal()}>Stake</button>}
                {active && <button className="App-button-option App-card-option" onClick={() => showUnstakeEsGmxModal()}>Unstake</button>}
                {!active && <button className="App-button-option App-card-option" onClick={() => connectWallet()}>Connect Wallet</button>}
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="Page-title-section">
        <div className="Page-title">Vest</div>
        <div className="Page-description">
          Convert esGMX tokens to GMX tokens.<br/>
          Please read the <a href="https://gmxio.gitbook.io/gmx/rewards#vesting" target="_blank" rel="noopener noreferrer">
            vesting details
          </a> before using the vaults.
        </div>
      </div>
      <div>
        <div className="StakeV2-cards">
          <div className="App-card StakeV2-gmx-card">
            <div className="App-card-title">GMX Vault</div>
            <div className="App-card-divider"></div>
            <div className="App-card-content">
              <div className="App-card-row">
                <div className="label">Staked Tokens</div>
                <div>
                  <Tooltip handle={formatAmount(totalRewardTokens, 18, 2, true)} position="right-bottom" renderContent={() => {
                    return <>
                      {formatAmount(processedData.gmxInStakedGmx, 18, 2, true)} GMX<br/>
                      {formatAmount(processedData.esGmxInStakedGmx, 18, 2, true)} esGMX<br/>
                      {formatAmount(processedData.bnGmxInFeeGmx, 18, 2, true)} Multiplier Points
                    </>
                  }} />
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Reserved for Vesting</div>
                <div>
                  {formatKeyAmount(vestingData, "gmxVesterPairAmount", 18, 2, true)} / {formatAmount(totalRewardTokens, 18, 2, true)}
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Vesting Status</div>
                <div>
                  <Tooltip
                    handle={`${formatKeyAmount(vestingData, "gmxVesterClaimSum", 18, 4, true)} / ${formatKeyAmount(vestingData, "gmxVesterVestedAmount", 18, 4, true)}`}
                    position="right-bottom"
                    renderContent={() => {
                      return <>
                        {formatKeyAmount(vestingData, "gmxVesterClaimSum", 18, 4, true)} tokens have been converted to GMX from the&nbsp;
                        {formatKeyAmount(vestingData, "gmxVesterVestedAmount", 18, 4, true)} esGMX deposited for vesting.
                      </>
                    }}
                  />
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Claimable</div>
                <div>
                  <Tooltip
                    handle={`${formatKeyAmount(vestingData, "gmxVesterClaimable", 18, 4, true)} GMX`}
                    position="right-bottom"
                    renderContent={() => `${formatKeyAmount(vestingData, "gmxVesterClaimable", 18, 4, true)} GMX tokens can be claimed, use the options under the Total Rewards section to claim them.`}
                  />
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-options">
                {!active && <button className="App-button-option App-card-option" onClick={() => connectWallet()}>Connect Wallet</button>}
                {active && <button className="App-button-option App-card-option" onClick={() => showGmxVesterDepositModal()}>Deposit</button>}
                {active && <button className="App-button-option App-card-option" onClick={() => showGmxVesterWithdrawModal()}>Withdraw</button>}
              </div>
            </div>
          </div>
          <div className="App-card StakeV2-gmx-card">
            <div className="App-card-title">GLP Vault</div>
            <div className="App-card-divider"></div>
            <div className="App-card-content">
              <div className="App-card-row">
                <div className="label">Staked Tokens</div>
                <div>
                  {formatAmount(processedData.glpBalance, 18, 2, true)} GLP
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Reserved for Vesting</div>
                <div>
                  {formatKeyAmount(vestingData, "glpVesterPairAmount", 18, 2, true)} / {formatAmount(processedData.glpBalance, 18, 2, true)}
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Vesting Status</div>
                <div>
                  <Tooltip
                    handle={`${formatKeyAmount(vestingData, "glpVesterClaimSum", 18, 4, true)} / ${formatKeyAmount(vestingData, "glpVesterVestedAmount", 18, 4, true)}`}
                    position="right-bottom"
                    renderContent={() => {
                      return <>
                        {formatKeyAmount(vestingData, "glpVesterClaimSum", 18, 4, true)} tokens have been converted to GMX from the&nbsp;
                        {formatKeyAmount(vestingData, "glpVesterVestedAmount", 18, 4, true)} esGMX deposited for vesting.
                      </>
                    }}
                  />
                </div>
              </div>
              <div className="App-card-row">
                <div className="label">Claimable</div>
                <div>
                  <Tooltip
                    handle={`${formatKeyAmount(vestingData, "glpVesterClaimable", 18, 4, true)} GMX`}
                    position="right-bottom"
                    renderContent={() => `${formatKeyAmount(vestingData, "glpVesterClaimable", 18, 4, true)} GMX tokens can be claimed, use the options under the Total Rewards section to claim them.`}>

                  </Tooltip>
                </div>
              </div>
              <div className="App-card-divider"></div>
              <div className="App-card-options">
                {!active && <button className="App-button-option App-card-option" onClick={() => connectWallet()}>Connect Wallet</button>}
                {active && <button className="App-button-option App-card-option" onClick={() => showGlpVesterDepositModal()}>Deposit</button>}
                {active && <button className="App-button-option App-card-option" onClick={() => showGlpVesterWithdrawModal()}>Withdraw</button>}
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer />
    </div>
  )
}