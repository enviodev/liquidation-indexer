import { Address, erc20Abi, erc20Abi_bytes32 } from "viem";
import { mainnet, optimism, arbitrum, polygon, base, gnosis, linea, scroll, avalanche, bsc } from 'viem/chains'
import * as fs from "fs";
import * as path from "path";
import { AaveV3Ethereum, AaveV3Optimism, AaveV3Arbitrum, AaveV3Polygon, AaveV3Base, AaveV3Gnosis, AaveV3Linea, AaveV3Scroll, AaveV3Avalanche, AaveV3BNB } from "@bgd-labs/aave-address-book"; 


const evaultAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../abis/EVault.json"), "utf8")
);

const eulerRouterAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../abis/EulerRouter.json"), "utf8")
);

const aaveV3OracleAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../abis/AaveV3Oracle.json"), "utf8")
);

const aaveUiPoolDataProviderAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../abis/AaveUiPoolDataProvider.json"), "utf8")
);

const aaveV3ProtocolDataProviderAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../abis/AaveV3ProtocolDataProvider.json"), "utf8")
);

const accountLensAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../abis/AccountLens.json"), "utf8")
);

const evcAbi = JSON.parse(
    fs.readFileSync(path.join(__dirname, "../abis/EVC.json"), "utf8")
);

export function getERC20Contract(address: Address) {
    return { address: address as `0x${string}`, abi: erc20Abi };
}

export function getERC20BytesContract(address: Address) {
    return {
        address: address as `0x${string}`,
        abi: erc20Abi_bytes32,
    };
}

export function getEVaultContract(address: Address) {
    return { address: address as `0x${string}`, abi: evaultAbi };
}

export function getEulerRouterContract(address: Address) {
    return { address: address as `0x${string}`, abi: eulerRouterAbi };
}

export function getAaveV3OracleContract(address: Address) {
    return { address: address as `0x${string}`, abi: aaveV3OracleAbi };
}

export function getAaveUiPoolDataProviderContract(address: Address) {
    return { address: address as `0x${string}`, abi: aaveUiPoolDataProviderAbi };
}

export function getAaveV3ProtocolDataProviderContract(address: Address) {
    return { address: address as `0x${string}`, abi: aaveV3ProtocolDataProviderAbi };
}

export function getAccountLensContract(address: Address) {
    return { address: address as `0x${string}`, abi: accountLensAbi };
}

export function getEVCContract(address: Address) {
    return { address: address as `0x${string}`, abi: evcAbi };
}

// Re-export RPC manager functions for backward compatibility and convenience
export { getRPCUrl, getAllRPCUrls, executeWithRPCRotation } from "./rpcManager";

// Re-export throttle manager for advanced usage/monitoring
export { rpcThrottleManager } from "./rpcThrottler";
  
export const getChain = (chainId: number) => {
    const chainMap: Record<number, any> = {
        1: mainnet,
        10: optimism,
        42161: arbitrum,
        137: polygon,
        8453: base,
        100: gnosis,
        59144: linea,
        534352: scroll,
        43114: avalanche,
        56: bsc,
    };
    const chain = chainMap[chainId] || mainnet;
    return chain;
};

export const getAaveV3UiPoolDataProviderAddress = (chainId: number) => {
    const chainMap: Record<number, string> = {
        1: "0x91c0eA31b49B69Ea18607702c5d9aC360bf3dE7d", // AaveV3Ethereum.UI_POOL_DATA_PROVIDER,
        10: "0xbd83DdBE37fc91923d59C8c1E0bDe0CccCa332d5", // AaveV3Optimism.UI_POOL_DATA_PROVIDER,
        42161: "0x145dE30c929a065582da84Cf96F88460dB9745A7", // AaveV3Arbitrum.UI_POOL_DATA_PROVIDER,
        137: "0xC69728f11E9E6127733751c8410432913123acf1", // AaveV3Polygon.UI_POOL_DATA_PROVIDER,
        8453: "0x174446a6741300cD2E7C1b1A636Fee99c8F83502", //AaveV3Base.UI_POOL_DATA_PROVIDER,
        100: "0x86E2938daE289763D4e09a7e42c5cCcA62Cf9809", // AaveV3Gnosis.UI_POOL_DATA_PROVIDER,
        59144: "0xf751969521E20A972A0776CDB0497Fad0F773F1F", // AaveV3Linea.UI_POOL_DATA_PROVIDER,
        534352: "0x29CF7aC4Fc122085c0D4DE8894f878F0b141F799", // AaveV3Scroll.UI_POOL_DATA_PROVIDER,
        43114: "0xF71DBe0FAEF1473ffC607d4c555dfF0aEaDb878d", // AaveV3Avalanche.UI_POOL_DATA_PROVIDER,
        56: "0x952F938949F965C70c83853e7ff28aa7af91005b", // AaveV3BNB.UI_POOL_DATA_PROVIDER,
    };
    const address = chainMap[chainId] || "";
    return address;
};

export const getAaveV3PoolAddressesProviderAddress = (chainId: number) => {
    const chainMap: Record<number, string> = {
        1: AaveV3Ethereum.POOL_ADDRESSES_PROVIDER,  
        10: AaveV3Optimism.POOL_ADDRESSES_PROVIDER,  
        42161: AaveV3Arbitrum.POOL_ADDRESSES_PROVIDER,  
        137: AaveV3Polygon.POOL_ADDRESSES_PROVIDER,  
        8453: AaveV3Base.POOL_ADDRESSES_PROVIDER,  
        100: AaveV3Gnosis.POOL_ADDRESSES_PROVIDER,
        59144: AaveV3Linea.POOL_ADDRESSES_PROVIDER,
        534352: AaveV3Scroll.POOL_ADDRESSES_PROVIDER,
        43114: AaveV3Avalanche.POOL_ADDRESSES_PROVIDER,  
        56: AaveV3BNB.POOL_ADDRESSES_PROVIDER,
    };
    const address = chainMap[chainId] || "";
    return address;
};

export const getAaveV3OracleAddress = (chainId: number) => {
    const chainMap: Record<number, string> = {
        1: AaveV3Ethereum.ORACLE,
        10: AaveV3Optimism.ORACLE,
        42161: AaveV3Arbitrum.ORACLE,
        137: AaveV3Polygon.ORACLE,
        8453: AaveV3Base.ORACLE,
        100: AaveV3Gnosis.ORACLE,
        59144: AaveV3Linea.ORACLE,
        534352: AaveV3Scroll.ORACLE,
        43114: AaveV3Avalanche.ORACLE,
        56: AaveV3BNB.ORACLE,
    };
    const address = chainMap[chainId] || "";
    return address;
};

export const getAaveV3ProtocolDataProviderAddress = (chainId: number) => {
    const chainMap: Record<number, string> = {
        1: "0x7B4EB56E7CD4b454BA8ff71E4518426369a138a3",
        10: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654",
        42161: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654", 
        137: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654", 
        8453: "0x2d8A3C5677189723C4cB8873CfC9C8976FDF38Ac", 
        100: "0x501B4c19dd9C2e06E94dA7b6D5Ed4ddA013EC741", 
        59144: "0x2D97F8FA96886Fd923c065F5457F9DDd494e3877", 
        534352: "0xa411Accec7000c52feE9bFeDaDc53E1CEF72d6d4",
        43114: "0x69FA688f1Dc47d4B5d8029D5a35FB7a548310654", 
        56: "0x41585C50524fb8c3899B43D7D797d9486AAc94DB", 
    };
    const address = chainMap[chainId] || "";
    return address;
};

export const getEulerEVCAddress = (chainId: number) => {
    const chainMap: Record<number, string> = {
        1: "0x0C9a3dd6b8F28529d72d7f9cE918D493519EE383",
        10: "0xbfB28650Cd13CE879E7D56569Ed4715c299823E4",
        42161: "0x6302ef0F34100CDDFb5489fbcB6eE1AA95CD1066",
        137: "0xa1C13F5c4929521F0bf31cBE03025cb75C214DCB",
        8453: "0x5301c7dD20bD945D2013b48ed0DEE3A284ca8989",
        100: "0xD1446CDaa29b342C04c6162023f3A645CB318736",
        59144: "0xd8CeCEe9A04eA3d941a959F68fb4486f23271d09",
        534352: "",
        43114: "0xddcbe30A761Edd2e19bba930A977475265F36Fa1",
        56: "0xb2E5a73CeE08593d1a076a2AE7A6e02925a640ea",
    };
    const address = chainMap[chainId] || "";
    return address;
};

export const getEulerAccountLensAddress = (chainId: number) => {
    const chainMap: Record<number, string> = {
        1: "0x8F59c64fA1Fb2a57e9D084ab3481a13e7db68753",
        10: "0xA932bF52EB25Ff4Cf7C1Cc4193992df699E001AE",
        42161: "0x032F247D272BF573F094ea4670281Bee11BAa559",
        137: "0x766989B70F2561Bb724671Cc95B5a13345438f1f",
        8453: "0x2f5d8dF1C98f84d8844A091F855a873B0d22a50b",
        100: "0x88dba8F560b7AC7C0Fa58Ec515E76e1577E43aBb",
        59144: "0x48Ab6Cd0667C84766C0aaE6CDa657F565C6Fc3f9",
        534352: "",
        43114: "0xECe15aF37c8C5aBD931d63F31cF696F8942A77E4",
        56: "0x505f3214DF11F3e7C7351e7C262E2bA1459fea60",
    };
    const address = chainMap[chainId] || "";
    return address;
};