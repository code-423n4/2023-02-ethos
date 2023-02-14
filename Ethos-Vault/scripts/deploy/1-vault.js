const {ethers} = require('hardhat');

async function main() {
  const Vault = await ethers.getContractFactory('ReaperVaultv1_4');

  const wantAddress = '0x45f4682B560d4e3B8FF1F1b3A38FDBe775C7177b';
  const tokenName = 'TOMB-MAI Tomb Crypt';
  const tokenSymbol = 'rf-TOMB-MAI';
  const depositFee = 0;
  const tvlCap = ethers.constants.MaxUint256;

  const vault = await Vault.deploy(wantAddress, tokenName, tokenSymbol, depositFee, tvlCap);

  await vault.deployed();
  console.log('Vault deployed to:', vault.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
