# Ethos Reserve contest details
- Total Prize Pool: $144,500
  - HM awards: $102,000 USDC 
  - QA report awards: $12,000 USDC (Notion Field: QA Pool, usually 10% of total award pool)
  - Gas report awards: $6,000 USDC (Notion Field: Gas Pool, usually 5% of total award pool)
  - Judge + presort awards: $24,000 USDC (Notion Field: Judge Fee)
  - Scout awards: $500 USDC (this field doesn't exist in Notion yet, usually $500 USDC)
- Join [C4 Discord](https://discord.gg/code4rena) to register
- Submit findings [using the C4 form](https://code4rena.com/contests/2023-02-ethos-reserve-contest/submit)
- [Read our guidelines for more details](https://docs.code4rena.com/roles/wardens)
- Starts February 16, 2023 20:00 UTC
- Ends March 07, 2023 20:00 UTC

## Automated Findings / Publicly Known Issues

Automated findings output for the contest can be found [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/slither-output-ethos).

Slither touches on some hot spots in our code, and while some of the findings may seem like false positives at face value, we invite you to look deeper. These concerns include issues with the handling of decimals and data structures. It is recommend that you compare Ethos' slither output above to Liquity's [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/slither-output-liquity).

# Overview

An overview of the codebase can be found [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/).  
A relatively simple explanation of the system can be found [here](https://medium.com/byte-masons/introducing-ethos-reserve-5f08fa6af52a).  
You can find definitions for all the terms used in the system [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/glossary).  
A table describing liquidations under different contexts can be found [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/liquidation-logic).  
  
Please familiarize yourself with the following acronyms...  
  
`Individual collateralization ratio (ICR):` a Trove's ICR is the ratio of the dollar value of its entire collateral at the current ETH:USD price, to its entire debt.  
`Nominal collateralization ratio (nominal ICR, NICR):` a Trove's nominal ICR is its entire collateral (in ETH) multiplied by 100e18 and divided by its entire debt.  
`Total collateralization ratio (TCR):` the ratio of the dollar value of the entire system collateral at the current ETH:USD price, to the entire system debt.  
`Critical collateralization ratio (CCR):` When the TCR is below the CCR, the system enters Recovery Mode.  

...and then gain an understanding of different liquidation contexts [here](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/liquidation-logic)

You can use a live version of Ethos Reserve [here](c4.ethos.finance). It is deployed on Optimism utilizing a real asset management vault, the code for which you can find [here](https://github.com/Byte-Masons/ethos-vaults).

# Scope

Many Ethos contracts utilize external calls to execute their business logic, but these calls are primarily sent to other contracts WITHIN the system.

There are 2 main points at which calls leave to other systems entirely - in the PriceFeed to read Chainlink oracles and in the ActivePool to deposit assets into ReaperVaultV2.

| Contract | SLOC | External Calls | Libraries | Purpose |
| ----------- | ----------- | ----------- | ----------- | ----------- |
| [Ethos-Core/contracts/CollateralConfig.sol](Ethos-Core/contracts/CollateralConfig.sol) | 71 | 0 | 3 | [CollateralConfig Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/collateralconfig) |
| [Ethos-Core/contracts/BorrowerOperations.sol](Ethos-Core/contracts/BorrowerOperations.sol) | 455 | 0 | 4 | [BorrowerOperations Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/borroweroperations) |
| [Ethos-Core/contracts/TroveManager.sol](Ethos-Core/contracts/TroveManager.sol) | 935 | 0 | 2 | [TroveManager Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/trovemanager) |
| [Ethos-Core/contracts/ActivePool.sol](Ethos-Core/contracts/ActivePool.sol) | 251 | 7 | 1 | [ActivePool Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/activepool) |
| [Ethos-Core/contracts/StabilityPool.sol](Ethos-Core/contracts/StabilityPool.sol) | 404 | 1 | 6 | [StabilityPool Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/stabilitypool) |
| [Ethos-Core/contracts/LQTY/CommunityIssuance.sol](Ethos-Core/contracts/LQTY/CommunityIssuance.sol) | 71 | 0 | 5 | [CommunityIssuance Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/communityissuance) |
| [Ethos-Core/contracts/LQTY/LQTYStaking.sol](Ethos-Core/contracts/LQTY/LQTYStaking.sol) | 183 | 1 | 7 | [LQTYStaking Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/lqtystaking) |
| [Ethos-Core/contracts/LUSDToken.sol](Ethos-Core/contracts/LUSDToken.sol) | 110 | 1 | 3 | [LUSDToken Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts-in-scope/lusdtoken) |
| [Ethos-Vaults/contracts/ReaperVaultV2.sol](Ethos-Vaults/contracts/ReaperVaultV2.sol) | 410 | 0 | 6 | [ReaperVaultV2 Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/reapervaultv2) |
| [Ethos-Vaults/contracts/ReaperVaultERC4626.sol](Ethos-Vaults/contracts/ReaperVaultERC4626.sol) | 81 | 0 | 0 | [ReaperVaultERC4626 Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/reapervaulterc4626) |
| [Ethos-Vaults/contracts/abstract/ReaperBaseStrategyV4.sol](Ethos-Vaults/contracts/abstract/ReaperBaseStrategyV4.sol) | 115 | 0 | 5 | [ReaperBaseStrategyV4 Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/reaperbasestrategyv4) |
| [Ethos-Vaults/contracts/ReaperStrategyGranarySupplyOnly.sol](Ethos-Vaults/contracts/ReaperStrategyGranarySupplyOnly.sol) | 135 | 1 | 4 | [ReaperStrategyGranarySupplyOnly Description](https://docs.reaper.farm/ethos-reserve-bounty-hunter-documentation/contracts/reaperstrategygranarysupplyonly) |

While we included the most heavily modified contracts in the table above, we are open to considering any critical bug found in the codebase for bounties. Bugs covered in this way would be those which would result in a change to our implementation.

## Out of scope

While some of these files might be good to add context for in-scope contracts, we won't be offering bounties for issues within them.

`Ethos-Core/contracts/Dependencies/`  
`Ethos-Core/contracts/Proxy/`  
`Ethos-Core/contracts/TestContracts/`  
`Ethos-Vaults/contracts/mixins/`
`Ethos-Vaults/contracts/mixins/`

# Additional Context

While we made broad changes to the Liquity codebase, the test suite has been updated to support them. We abided by their design patterns throughout, with the riskiest areas being the following:

* active pool rebalancing with vault (assuming vault is not incurring losses): `contracts/ActivePool.sol`, `contracts/TestContracts/ERC4626.sol`  
* community issuance to stability pool: `contracts/LQTY/CommunityIssuance.sol`, `contracts/StabilityPool.sol`  
* decimal conversions within the system when dealing with collateral that's non-18 decimals  

## Scoping Details 
```
- If you have a public code repo, please share it here:  n/a
- How many contracts are in scope?:   28
- Total SLoC for these contracts?:  4000
- How many external imports are there?: 15 
- How many separate interfaces and struct definitions are there for the contracts within scope?:  25
- Does most of your code generally use composition or inheritance?:   inheritance
- How many external calls?:   2
- What is the overall line coverage percentage provided by your tests?:  95
- Is there a need to understand a separate part of the codebase / get context in order to audit this part of the protocol?:   true
- Please describe required context:   There are 2 systems - the stablecoin protocol and the asset management vault. The former is heavily modified from the Liquity codebase, the latter is a modified solidity implementation of yearn-style Multi-Strategy vaults. The stablecoin protocol deposits assets into the vault to generate yield through ActivePool.sol.

- Does the token conform to the ERC20 standard?:  yes
- Are there any novel or unique curve logic or mathematical models?: It uses a curve to set the fee during high volume periods
- Does it use an oracle?:  Chainlink, with Tellor oracles as backup
- Is it a fork or alternate implementation of another project? True; Liquity - we added multi-collateral support, made the token migratable, added a system that can farm with the underlying collateral, and changed how rewards are distributed to the stability pool. On the vault end, we re-implemented Yearn vaults in Solidity, added modern features like proxies and ERC-4626 interfaces and some extra state. 
- Does it use a side-chain?: true; EVM-compatible side-chain or Layer 2 networks
- Describe any specific areas you would like addressed. E.g. Please try to break XYZ.: Would like users to try and break the asset management accounting, the liquidation logic, and the issuance and redemption logic
```

# Tests

For each package (`Ethos Core, Ethos-Vaults`), First clone the repository and install dependencies using:
```
npm install
```
In Ethos-Vaults, add a .env file using either the dummy keys provided in `.env.example` or your own.

Run all tests with `npx hardhat test`, or run a specific test with `npx hardhat test ./test/contractTest.js`

To run a specific test in a file without running others, append the `it` method with `.only` like this:
```
it.only("name of test")
```
Hardhat will only run tests using the `.only` method in that file

# Slither

In order to get `slither` to run in `Ethos-Core`, you must append the flag `--compile-force-framework hardhat`

## Known Issues

There is a loss of precision in line 112 of `CommunityIssuance.sol`. Though we consider this out of the contest's scope, we are open to field arguments for implementation changes under the QA bucket of rewards.
