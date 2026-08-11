export async function delay(ms: number = 1500) {
  return await new Promise((resolve) => setTimeout(resolve, ms));
}
