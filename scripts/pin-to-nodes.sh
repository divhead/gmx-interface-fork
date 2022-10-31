export SSH_ADDRESS=root@143.244.184.22

ssh -o StrictHostKeyChecking=no $SSH_ADDRESS "rm -rf ~/ipfs-staging/build"

rsync -e "ssh -o StrictHostKeyChecking=no" -r ./build $SSH_ADDRESS:~/ipfs-staging;

ssh -o StrictHostKeyChecking=no $SSH_ADDRESS "docker exec ipfs-node ipfs add -rQ /export/build"