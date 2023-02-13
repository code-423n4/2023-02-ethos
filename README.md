# ✨ So you want to sponsor a contest

This `README.md` contains a set of checklists for our contest collaboration.

Your contest will use two repos: 
- **a _contest_ repo** (this one), which is used for scoping your contest and for providing information to contestants (wardens)
- **a _findings_ repo**, where issues are submitted (shared with you after the contest) 

Ultimately, when we launch the contest, this contest repo will be made public and will contain the smart contracts to be reviewed and all the information needed for contest participants. The findings repo will be made public after the contest report is published and your team has mitigated the identified issues.

Some of the checklists in this doc are for **C4 (🐺)** and some of them are for **you as the contest sponsor (⭐️)**.

---

# Repo setup

## ⭐️ Sponsor: Add code to this repo

- [ ] Create a PR to this repo with the below changes:
- [X] Provide a self-contained repository with working commands that will build (at least) all in-scope contracts, and commands that will run tests producing gas reports for the relevant contracts.
- [X] Make sure your code is thoroughly commented using the [NatSpec format](https://docs.soliditylang.org/en/v0.5.10/natspec-format.html#natspec-format).
- [ ] Please have final versions of contracts and documentation added/updated in this repo **no less than 24 hours prior to contest start time.**
- [ ] Be prepared for a 🚨code freeze🚨 for the duration of the contest — important because it establishes a level playing field. We want to ensure everyone's looking at the same code, no matter when they look during the contest. (Note: this includes your own repo, since a PR can leak alpha to our wardens!)


---

## ⭐️ Sponsor: Edit this README

Under "SPONSORS ADD INFO HERE" heading below, include the following:

- [X] Modify the bottom of this `README.md` file to describe how your code is supposed to work with links to any relevent documentation and any other criteria/details that the C4 Wardens should keep in mind when reviewing. ([Here's a well-constructed example.](https://github.com/code-423n4/2022-08-foundation#readme))
  - [X] When linking, please provide all links as full absolute links versus relative links
  - [X] All information should be provided in markdown format (HTML does not render on Code4rena.com)
- [X] Under the "Scope" heading, provide the name of each contract and:
  - [X] source lines of code (excluding blank lines and comments) in each
  - [X] external contracts called in each
  - [X] libraries used in each
- [X] Describe any novel or unique curve logic or mathematical models implemented in the contracts
- [X] Does the token conform to the ERC-20 standard? In what specific ways does it differ?
- [X] Describe anything else that adds any special logic that makes your approach unique
- [X] Identify any areas of specific concern in reviewing the code
- [ ] Optional / nice to have: pre-record a high-level overview of your protocol (not just specific smart contract functions). This saves wardens a lot of time wading through documentation.
- [ ] See also: [this checklist in Notion](https://code4rena.notion.site/Key-info-for-Code4rena-sponsors-f60764c4c4574bbf8e7a6dbd72cc49b4#0cafa01e6201462e9f78677a39e09746)
- [ ] Delete this checklist and all text above the line below when you're ready.

---

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

Automated findings output for the contest can be found [here](add link to report) within an hour of contest opening.

*Note for C4 wardens: Anything included in the automated findings output is considered a publicly known issue and is ineligible for awards.*

[ ⭐️ SPONSORS ADD INFO HERE ]

# Overview

We will deploy a live version of Ethos Reserve on Optimism Mainnet that uses a real asset management vault

An overview of the codebase can be found [here](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/).  
A relatively simple explanation of the system can be found [here](https://medium.com/byte-masons/introducing-ethos-reserve-5f08fa6af52a).  
You can find definitions for all the terms used in the system [here](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/~/changes/1/glossary).  
A table describing liquidations under different contexts can be found [here](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/liquidation-logic).  
  
Please familiarize yourself with the following acronyms...  
  
`Individual collateralization ratio (ICR):` a Trove's ICR is the ratio of the dollar value of its entire collateral at the current ETH:USD price, to its entire debt.  
`Nominal collateralization ratio (nominal ICR, NICR):` a Trove's nominal ICR is its entire collateral (in ETH) multiplied by 100e18 and divided by its entire debt.  
`Total collateralization ratio (TCR):` the ratio of the dollar value of the entire system collateral at the current ETH:USD price, to the entire system debt.  
`Critical collateralization ratio (CCR):` When the TCR is below the CCR, the system enters Recovery Mode.  

...and then gain an understanding of different liquidation contexts [here(https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/liquidation-logic)]

# Scope

| Contract | SLOC | External Calls | Libraries | Purpose |
| ----------- | ----------- | ----------- | ----------- |
| [contracts/CollateralConfig.sol](contracts/CollateralConfig.sol) | 71 | [CollateralConfig Description](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/contracts/collateralconfig) |
| [contracts/BorrowerOperations.sol](contracts/BorrowerOperations.sol) | 455 | [BorrowerOperations Description](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/contracts/borroweroperations) |
| [contracts/TroveManager.sol](contracts/TroveManager.sol) | 935 | [TroveManager Description](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/contracts/trovemanager) |
| [contracts/ActivePool.sol](contracts/ActivePool.sol) | 251 | [ActivePool Description](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/contracts/activepool) |
| [contracts/StabilityPool.sol](contracts/StabilityPool.sol) | 404 | [StabilityPool Description](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/contracts/stabilitypool) |
| [contracts/CommunityIssuance.sol](contracts/CommunityIssuance.sol) | 71 | [CommunityIssuance Description](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/contracts/communityissuance) |
| [contracts/LQTYStaking.sol](contracts/LQTYStaking.sol) | 183 | [LQTYStaking Description](https://app.gitbook.com/o/-MaHAMvqjUJYiOUPjcHt/s/VZOmHMDAAsleBLlHxrqx/contracts/lqtystaking) |

## Out of scope

While some of these files might be good to add context for in-scope contracts, we won't be offering bounties for issues within them.

`contracts/Dependencies`  
`contracts/Proxy`  
`contracts/TestContracts/`  

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

First clone the repository and install dependencies using:
```
yarn install
```

Run all tests with `npx hardhat test`, or run a specific test with `npx hardhat test ./test/contractTest.js`

To run a specific test in a file without running others, append the `it` method with `.only` like this:
```
it.only("name of test")
```
Hardhat will only run tests using the `.only` method in that file

## Known Issues

There is a loss of precision in line 112 of `CommunityIssuance.sol`. Though we consider this out of the contest's scope, we are open to field arguments for implementation changes under the QA bucket of rewards.