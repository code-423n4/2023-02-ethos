# Ethos Reserve contest details
- Total Prize Pool: $144,750
  - HM awards: $102,000 USDC 
  - QA report awards: $12,000 USDC 
  - Gas report awards: $6,000 USDC 
  - Judge + presort awards: $24,000 USDC 
  - Scout awards: $750 USDC 
- Join [C4 Discord](https://discord.gg/code4rena) to register
- Submit findings [using the C4 form](https://code4rena.com/contests/2023-02-ethos-reserve-contest/submit)
- [Read our guidelines for more details](https://docs.code4rena.com/roles/wardens)
- Starts February 16, 2023 20:00 UTC
- Ends March 07, 2023 20:00 UTC

## Automated Findings / Publicly Known Issues

Automated findings output for the Ethos-Core package can be found [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/useful-information/slither-output-ethos-core).  
Automated findings output for the Ethos-Vault package can be found [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/useful-information/slither-output-ethos-vault).

If you're looking for a head start, we recommend that you compare Ethos-Core's slither output above to Liquity's [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/useful-information/slither-output-liquity).

# Overview

You can find a video walkthrough of the repository [here](https://www.loom.com/share/dc3f31b93aae412697eb105724a8d327).

An overview of the codebase can be found [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/).  
A relatively simple explanation of the system can be found [here](https://medium.com/byte-masons/introducing-ethos-reserve-5f08fa6af52a).  
You can find definitions for all the terms used in the system [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/useful-information/glossary).  
A table describing liquidations under different contexts can be found [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/useful-information/liquidation-logic).  
  
Please familiarize yourself with the following acronyms...  
  
`Individual collateralization ratio (ICR):` a Trove's ICR is the ratio of the dollar value of its entire collateral at the current ETH:USD price, to its entire debt.  
`Nominal collateralization ratio (nominal ICR, NICR):` a Trove's nominal ICR is its entire collateral (in ETH) multiplied by 100e18 and divided by its entire debt.  
`Total collateralization ratio (TCR):` the ratio of the dollar value of the entire system collateral at the current ETH:USD price, to the entire system debt.  
`Critical collateralization ratio (CCR):` When the TCR is below the CCR, the system enters Recovery Mode.  

...and then gain an understanding of different liquidation contexts [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/useful-information/liquidation-logic)

A link to the live version of Ethos Reserve will be provided on Discord during the contest.

# Scope

Many Ethos contracts utilize external calls to execute their business logic, but these calls are primarily sent to other contracts WITHIN the system and access control is tested thoroughly, so we don't include them in the external calls column.  

Additionally, you will find there is a lot of code in the app that we don't include in our scope - this is because the codebase we built on is heavily battle tested, we haven't made risky changes to those contracts, and we've tested these areas thoroughly. If bugs are found in contracts not listed in the table below, we are open to rewarding the auditor if the findings result in an implementation change, however the primary focus of auditors should be files below.

| Contract | SLOC | External Calls | Libraries | Purpose |
| ----------- | ----------- | ----------- | ----------- | ----------- |
| [Ethos-Core/contracts/CollateralConfig.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Core/contracts/CollateralConfig.sol) | 71 | 0 | 3 | [CollateralConfig Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/collateralconfig) |
| [Ethos-Core/contracts/BorrowerOperations.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Core/contracts/BorrowerOperations.sol) | 455 | 0 | 4 | [BorrowerOperations Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/borroweroperations) |
| [Ethos-Core/contracts/TroveManager.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Core/contracts/TroveManager.sol) | 935 | 0 | 2 | [TroveManager Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/trovemanager) |
| [Ethos-Core/contracts/ActivePool.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Core/contracts/ActivePool.sol) | 251 | 1 | 7 | [ActivePool Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/activepool) |
| [Ethos-Core/contracts/StabilityPool.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Core/contracts/StabilityPool.sol) | 404 | 1 | 6 | [StabilityPool Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/stabilitypool) |
| [Ethos-Core/contracts/LQTY/CommunityIssuance.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Core/contracts/LQTY/CommunityIssuance.sol) | 71 | 0 | 5 | [CommunityIssuance Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/communityissuance) |
| [Ethos-Core/contracts/LQTY/LQTYStaking.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Core/contracts/LQTY/LQTYStaking.sol) | 183 | 1 | 7 | [LQTYStaking Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/lqtystaking) |
| [Ethos-Core/contracts/LUSDToken.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Core/contracts/LUSDToken.sol) | 110 | 1 | 3 | [LUSDToken Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/lusdtoken) |
| [Ethos-Vault/contracts/ReaperVaultV2.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Vault/contracts/ReaperVaultV2.sol) | 410 | 0 | 6 | [ReaperVaultV2 Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/reapervaultv2) |
| [Ethos-Vault/contracts/ReaperVaultERC4626.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Vault/contracts/ReaperVaultERC4626.sol) | 81 | 0 | 0 | [ReaperVaultERC4626 Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/reapervaulterc4626) |
| [Ethos-Vault/contracts/abstract/ReaperBaseStrategyV4.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Vault/contracts/abstract/ReaperBaseStrategyv4.sol) | 115 | 0 | 5 | [ReaperBaseStrategyV4 Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/reaperbasestrategyv4) |
| [Ethos-Vault/contracts/ReaperStrategyGranarySupplyOnly.sol](https://github.com/code-423n4/2023-02-ethos/blob/main/Ethos-Vault/contracts/ReaperStrategyGranarySupplyOnly.sol) | 135 | 1 | 4 | [ReaperStrategyGranarySupplyOnly Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/reaperstrategygranarysupplyonly) |

## Out of scope

While some of these files might be good to add context for in-scope contracts, we won't be offering bounties for issues within them.

`Ethos-Core/contracts/Dependencies/`  
`Ethos-Core/contracts/Proxy/`  
`Ethos-Core/contracts/TestContracts/`  
`Ethos-Vault/contracts/mixins/`  
`Ethos-Vault/contracts/libraries/`  

# Additional Context

While we made broad changes to the Liquity codebase, the test suite has been updated to support them. We abided by their design patterns throughout, with the riskiest areas being the following:

* active pool rebalancing with vault (assuming vault is not incurring losses): `Ethos-Core/contracts/ActivePool.sol`, `Ethos-Vault/contracts/ReaperVaultV2.sol`  
* community issuance to stability pool: `Ethos-Core/contracts/LQTY/CommunityIssuance.sol`, `Ethos-Core/contracts/StabilityPool.sol`  
* decimal conversions within the system when dealing with collateral that's non-18 decimals  

## Scoping Details 
```
- If you have a public code repo, please share it here:  n/a
- How many contracts are in scope?:   11
- Total SLoC for these contracts?:  3500
- How many external imports are there?: 40 
- How many separate interfaces and struct definitions are there for the contracts within scope?:  30
- Does most of your code generally use composition or inheritance?:   inheritance
- How many external calls?:   3
- What is the overall line coverage percentage provided by your tests?:  93
- Is there a need to understand a separate part of the codebase / get context in order to audit this part of the protocol?:   false
- Please describe required context:   
- Does the token conform to the ERC20 standard?:  yes
- Are there any novel or unique curve logic or mathematical models?: It uses a curve to set the fee during high volume periods
- Does it use an oracle?:  Chainlink
- Is it a fork or alternate implementation of another project? True; Liquity and Yearn V2 
- Does it use a side-chain?: true
- Describe any specific areas you would like addressed. E.g. Please try to break XYZ.: Would like users to try and break the asset management accounting, the liquidation logic, and the issuance and redemption logic
```

# Tests

For each package (`Ethos Core, Ethos-Vault`), First clone the repository and install dependencies using:
```
npm install
```
In Ethos-Vault, add a .env file using either the dummy keys provided in `.env.example` or your own.

Run all tests with `npx hardhat test`, or run a specific test with `npx hardhat test ./test/contractTest.js`

To run a specific test in a file without running others, append the `it` method with `.only` like this:
```
it.only("name of test")
```
Hardhat will only run tests using the `.only` method in that file

## Known Issues

There is a loss of precision in line 112 of `CommunityIssuance.sol`. Though we consider this out of the contest's scope, we are open to field arguments for implementation changes under the QA bucket of rewards.

We are aware that adding large amounts of collateral types could cause gas prices to increase and state updates to eventually fail. Our plan is to have only 2-5 collateral types in any given deployment. We may add a require statement to the CollateralConfig constructor down the line but consider this a known issue.

You can find known issues in the Liquity codebase [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/useful-information/liquity-known-issues).


