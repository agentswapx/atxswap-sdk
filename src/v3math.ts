/**
 * V3 concentrated liquidity: token amounts from liquidity L at current sqrt price.
 * Aligns with Uniswap V3 Periphery LiquidityAmounts.getAmountsForLiquidity and frontend v3math.ts.
 */

const Q96 = 2n ** 96n;

export function tickToSqrtPriceX96(tick: number): bigint {
  const sqrtPrice = Math.sqrt(1.0001 ** tick);
  return BigInt(Math.round(sqrtPrice * Number(Q96)));
}

function getAmount0ForLiquidity(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint): bigint {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) [a, b] = [b, a];
  if (a === b || liquidity === 0n) return 0n;
  const diff = b - a;
  return (liquidity * Q96 * diff) / b / a;
}

function getAmount1ForLiquidity(sqrtRatioAX96: bigint, sqrtRatioBX96: bigint, liquidity: bigint): bigint {
  let a = sqrtRatioAX96;
  let b = sqrtRatioBX96;
  if (a > b) [a, b] = [b, a];
  if (a === b || liquidity === 0n) return 0n;
  return (liquidity * (b - a)) / Q96;
}

/**
 * @param sqrtRatioX96 Current pool sqrtPriceX96 from slot0
 */
export function getAmountsForLiquidity(
  sqrtRatioX96: bigint,
  tickLower: number,
  tickUpper: number,
  liquidity: bigint,
): { amount0: bigint; amount1: bigint } {
  if (liquidity === 0n || sqrtRatioX96 === 0n) return { amount0: 0n, amount1: 0n };

  let sqrtA = tickToSqrtPriceX96(tickLower);
  let sqrtB = tickToSqrtPriceX96(tickUpper);
  if (sqrtA > sqrtB) [sqrtA, sqrtB] = [sqrtB, sqrtA];

  if (sqrtRatioX96 <= sqrtA) {
    return { amount0: getAmount0ForLiquidity(sqrtA, sqrtB, liquidity), amount1: 0n };
  }
  if (sqrtRatioX96 >= sqrtB) {
    return { amount0: 0n, amount1: getAmount1ForLiquidity(sqrtA, sqrtB, liquidity) };
  }
  return {
    amount0: getAmount0ForLiquidity(sqrtRatioX96, sqrtB, liquidity),
    amount1: getAmount1ForLiquidity(sqrtA, sqrtRatioX96, liquidity),
  };
}
