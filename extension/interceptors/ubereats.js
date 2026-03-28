/**
 * Uber Eats interceptor module.
 *
 * Defines which URLs to watch and how to normalize the responses
 * into Profit Duck's expected CSV-row format.
 */

export const ubereatsInterceptor = {
  /** Host pattern to match */
  hostPattern: "merchants.ubereats.com",

  /** Platform identifier sent to the server */
  platform: "ubereats",

  /**
   * Check if a URL is likely to contain order/payment data.
   * @param {string} url
   * @returns {boolean}
   */
  shouldIntercept(url) {
    const lower = url.toLowerCase();
    return (
      lower.includes("/api/") ||
      lower.includes("/graphql") ||
      lower.includes("/eats/")
    ) && (
      lower.includes("order") ||
      lower.includes("payment") ||
      lower.includes("payout") ||
      lower.includes("transaction") ||
      lower.includes("earning") ||
      lower.includes("statement")
    );
  },
};
