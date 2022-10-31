export SSH_ADDRESS=root@143.244.184.22

ssh $SSH_ADDRESS "rm -rf ~/ipfs-staging/build"

rsync -r ./build $SSH_ADDRESS:~/ipfs-staging;

ssh $SSH_ADDRESS "docker exec ipfs-node ipfs add -rQ /export/build"