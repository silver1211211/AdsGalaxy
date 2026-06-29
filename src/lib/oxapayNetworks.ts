export type OxaPayDepositNetwork = {
  id: string;
  oxapayNetwork: string;
  name: string;
  chain: string;
  currency: string;
  icon: string;
  tone: string;
  logo: string;
  networkLogo: string;
};

export const OXAPAY_DEPOSIT_NETWORKS: OxaPayDepositNetwork[] = [
  { id: "USDT_TRON", oxapayNetwork: "Tron", name: "Tether", chain: "TRC20", currency: "USDT", icon: "TRX", tone: "bg-red-50 text-red-600 border-red-200", logo: "/crypto/usdt.png", networkLogo: "/crypto/tron.png" },
  { id: "USDT_BSC", oxapayNetwork: "BSC", name: "Tether", chain: "BEP20", currency: "USDT", icon: "BNB", tone: "bg-amber-50 text-amber-600 border-amber-200", logo: "/crypto/usdt.png", networkLogo: "/crypto/bnb.png" },
  { id: "USDT_ETHEREUM", oxapayNetwork: "Ethereum", name: "Tether", chain: "ERC20", currency: "USDT", icon: "ETH", tone: "bg-slate-100 text-slate-700 border-slate-200", logo: "/crypto/usdt.png", networkLogo: "/crypto/ethereum.png" },
  { id: "USDT_POLYGON", oxapayNetwork: "Polygon", name: "Tether", chain: "Polygon", currency: "USDT", icon: "POL", tone: "bg-violet-50 text-violet-600 border-violet-200", logo: "/crypto/usdt.png", networkLogo: "/crypto/polygon.png" },
  { id: "USDT_TON", oxapayNetwork: "The Open Network", name: "Tether", chain: "TON", currency: "USDT", icon: "TON", tone: "bg-cyan-50 text-cyan-600 border-cyan-200", logo: "/crypto/usdt.png", networkLogo: "/crypto/ton.png" },
  { id: "USDC_ETHEREUM", oxapayNetwork: "Ethereum", name: "USD Coin", chain: "ERC20", currency: "USDC", icon: "USDC", tone: "bg-blue-50 text-blue-600 border-blue-200", logo: "/crypto/usdc.png", networkLogo: "/crypto/ethereum.png" },
  { id: "BTC_BITCOIN", oxapayNetwork: "Bitcoin", name: "Bitcoin", chain: "Bitcoin", currency: "BTC", icon: "BTC", tone: "bg-orange-50 text-orange-600 border-orange-200", logo: "/crypto/bitcoin.png", networkLogo: "/crypto/bitcoin.png" },
  { id: "ETH_ETHEREUM", oxapayNetwork: "Ethereum", name: "Ethereum", chain: "Ethereum", currency: "ETH", icon: "ETH", tone: "bg-slate-100 text-slate-700 border-slate-200", logo: "/crypto/ethereum.png", networkLogo: "/crypto/ethereum.png" },
  { id: "ETH_BASE", oxapayNetwork: "Base", name: "Ethereum", chain: "Base", currency: "ETH", icon: "ETH", tone: "bg-blue-50 text-blue-600 border-blue-200", logo: "/crypto/ethereum.png", networkLogo: "/crypto/base.png" },
  { id: "BNB_BSC", oxapayNetwork: "BSC", name: "BNB", chain: "BEP20", currency: "BNB", icon: "BNB", tone: "bg-amber-50 text-amber-600 border-amber-200", logo: "/crypto/bnb.png", networkLogo: "/crypto/bnb.png" },
  { id: "TRX_TRON", oxapayNetwork: "Tron", name: "Tron", chain: "TRC20", currency: "TRX", icon: "TRX", tone: "bg-red-50 text-red-600 border-red-200", logo: "/crypto/tron.png", networkLogo: "/crypto/tron.png" },
  { id: "SOL_SOLANA", oxapayNetwork: "Solana", name: "Solana", chain: "Solana", currency: "SOL", icon: "SOL", tone: "bg-purple-50 text-purple-600 border-purple-200", logo: "/crypto/solana.png", networkLogo: "/crypto/solana.png" },
  { id: "TON_TON", oxapayNetwork: "The Open Network", name: "Toncoin", chain: "TON", currency: "TON", icon: "TON", tone: "bg-cyan-50 text-cyan-600 border-cyan-200", logo: "/crypto/ton.png", networkLogo: "/crypto/ton.png" },
  { id: "LTC_LITECOIN", oxapayNetwork: "Litecoin", name: "Litecoin", chain: "Litecoin", currency: "LTC", icon: "LTC", tone: "bg-slate-50 text-slate-500 border-slate-200", logo: "/crypto/litecoin.png", networkLogo: "/crypto/litecoin.png" },
  { id: "DOGE_DOGECOIN", oxapayNetwork: "Dogecoin", name: "Dogecoin", chain: "Dogecoin", currency: "DOGE", icon: "DOGE", tone: "bg-yellow-50 text-yellow-700 border-yellow-200", logo: "/crypto/dogecoin.png", networkLogo: "/crypto/dogecoin.png" },
  { id: "POL_POLYGON", oxapayNetwork: "Polygon", name: "Polygon", chain: "Polygon", currency: "POL", icon: "POL", tone: "bg-violet-50 text-violet-600 border-violet-200", logo: "/crypto/polygon.png", networkLogo: "/crypto/polygon.png" },
  { id: "DAI_POLYGON", oxapayNetwork: "Polygon", name: "DAI", chain: "Polygon", currency: "DAI", icon: "DAI", tone: "bg-yellow-50 text-yellow-700 border-yellow-200", logo: "/crypto/dai.png", networkLogo: "/crypto/polygon.png" },
  { id: "XMR_MONERO", oxapayNetwork: "Monero", name: "Monero", chain: "Monero", currency: "XMR", icon: "XMR", tone: "bg-orange-50 text-orange-700 border-orange-200", logo: "/crypto/monero.png", networkLogo: "/crypto/monero.png" },
  { id: "BCH_BITCOINCASH", oxapayNetwork: "BitcoinCash", name: "Bitcoin Cash", chain: "Bitcoin Cash", currency: "BCH", icon: "BCH", tone: "bg-lime-50 text-lime-700 border-lime-200", logo: "/crypto/bitcoin-cash.png", networkLogo: "/crypto/bitcoin-cash.png" },
  { id: "SHIB_BSC", oxapayNetwork: "BSC", name: "Shiba Inu", chain: "BEP20", currency: "SHIB", icon: "SHIB", tone: "bg-orange-50 text-orange-600 border-orange-200", logo: "/crypto/shiba-inu.png", networkLogo: "/crypto/bnb.png" },
  { id: "NOT_TON", oxapayNetwork: "The Open Network", name: "NotCoin", chain: "TON", currency: "NOT", icon: "NOT", tone: "bg-slate-50 text-slate-700 border-slate-200", logo: "/crypto/notcoin.jpg", networkLogo: "/crypto/ton.png" },
  { id: "DOGS_TON", oxapayNetwork: "The Open Network", name: "Dogs", chain: "TON", currency: "DOGS", icon: "DOGS", tone: "bg-sky-50 text-sky-600 border-sky-200", logo: "/crypto/dogs.png", networkLogo: "/crypto/ton.png" },
];

export const OXAPAY_USDT_NETWORKS = OXAPAY_DEPOSIT_NETWORKS;

const NETWORKS_BY_ID = new Map(OXAPAY_DEPOSIT_NETWORKS.map((network) => [network.id, network]));
const LEGACY_NETWORKS_BY_ID = new Map([
  ["BEP20", "USDT_BSC"],
  ["TRC20", "USDT_TRON"],
  ["ERC20", "USDT_ETHEREUM"],
  ["POLYGON", "USDT_POLYGON"],
  ["TON", "USDT_TON"],
]);

export function normalizeOxaPayNetwork(value: unknown) {
  return String(value || "").trim().toUpperCase().replace(/[\s-]/g, "_");
}

export function getOxaPayDepositNetwork(value: unknown) {
  const normalized = normalizeOxaPayNetwork(value);
  return NETWORKS_BY_ID.get(normalized) || NETWORKS_BY_ID.get(LEGACY_NETWORKS_BY_ID.get(normalized) || "");
}
