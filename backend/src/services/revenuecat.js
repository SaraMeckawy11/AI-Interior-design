import axios from 'axios';

const REVENUECAT_URL = 'https://api.revenuecat.com/v1/subscribers';

/** Compare Google identifiers with or without a base-plan/purchase-option suffix. */
export function sameStoreProduct(left, right) {
  if (!left || !right) return false;
  const a = String(left);
  const b = String(right);
  return a === b || a.split(':')[0] === b.split(':')[0];
}

/**
 * The configured secret key, with the whitespace a dashboard paste adds.
 *
 * A key pasted into a hosting dashboard arrives with a trailing newline often
 * enough that it is worth handling here. Node refuses to put a newline in a
 * header value and throws ERR_INVALID_CHAR from inside axios, so the request
 * never left the server — and the failure surfaced as a bare "Server error"
 * after the customer had already been charged, because it is neither a missing
 * key nor an HTTP status this code knew how to read.
 */
export function revenueCatApiKey() {
  return String(process.env.REVENUECAT_API_KEY || '').trim();
}

/** Fetch RevenueCat's server-side view of one customer. */
export async function getRevenueCatCustomer(appUserId) {
  const apiKey = revenueCatApiKey();
  if (!apiKey) {
    const error = new Error('REVENUECAT_API_KEY is not configured.');
    error.code = 'REVENUECAT_NOT_CONFIGURED';
    throw error;
  }

  // Anything still unprintable after trimming would throw from deep inside the
  // HTTP client. Caught here instead, where the message can name the cause.
  if (!/^[\x21-\x7e]+$/.test(apiKey)) {
    const error = new Error(
      'REVENUECAT_API_KEY contains characters that cannot be sent in a header. '
      + 'Re-copy the secret key and check for stray spaces or line breaks.',
    );
    error.code = 'REVENUECAT_NOT_CONFIGURED';
    throw error;
  }

  const response = await axios.get(
    `${REVENUECAT_URL}/${encodeURIComponent(String(appUserId))}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        Accept: 'application/json',
      },
      timeout: 10_000,
    },
  );

  return response.data?.subscriber || null;
}

/**
 * Confirm that RevenueCat recorded this non-subscription transaction for this
 * user and this product. The mobile app is never trusted to assign coin value.
 */
export async function hasNonSubscriptionPurchase(appUserId, productId, transactionId) {
  const subscriber = await getRevenueCatCustomer(appUserId);
  const purchases = subscriber?.non_subscriptions || {};

  return Object.entries(purchases).some(([storedProductId, transactions]) => {
    if (!sameStoreProduct(storedProductId, productId) || !Array.isArray(transactions)) {
      return false;
    }

    return transactions.some((transaction) => (
      String(transaction?.id || '') === String(transactionId)
      || String(transaction?.store_transaction_id || '') === String(transactionId)
    ));
  });
}

/** Return RevenueCat-verified subscription data, or null while it is absent/inactive. */
async function findActiveSubscription(appUserId, { productId, transactionId } = {}) {
  const subscriber = await getRevenueCatCustomer(appUserId);
  const subscriptions = subscriber?.subscriptions || {};
  const match = Object.entries(subscriptions).find(([storedProductId, subscription]) => {
    if (productId && !sameStoreProduct(storedProductId, productId)) return false;
    if (subscription?.refunded_at) return false;
    if (
      transactionId
      && subscription?.store_transaction_id
      && String(subscription.store_transaction_id) !== String(transactionId)
    ) {
      return false;
    }
    const expiresAt = new Date(subscription?.expires_date || 0);
    return !Number.isNaN(expiresAt.getTime()) && expiresAt > new Date();
  });

  if (!match) return null;
  const [verifiedProductId, subscription] = match;
  const entitlement = Object.entries(subscriber?.entitlements || {}).find(
    ([, value]) => sameStoreProduct(value?.product_identifier, verifiedProductId),
  );

  // Every subscription sold here must grant Pro. A missing entitlement means
  // the dashboard product has not been attached correctly.
  if (!entitlement) return null;

  // `unsubscribe_detected_at` is the store telling us auto-renew was switched
  // off. The subscription is still active until it expires — that is why this
  // is reported alongside a live entitlement rather than instead of one — but
  // it will not renew, and it is the only durable record of that choice. A copy
  // kept solely on our own Order row does not survive the row being deleted.
  const unsubscribeDetectedAt = subscription.unsubscribe_detected_at || null;

  return {
    productId: verifiedProductId,
    transactionId: subscription.store_transaction_id || transactionId,
    purchaseDate: subscription.purchase_date,
    expiresDate: subscription.expires_date,
    entitlementId: entitlement[0],
    unsubscribeDetectedAt,
    autoRenew: !unsubscribeDetectedAt,
  };
}

/** Verify one just-purchased product before recording it locally. */
export function getActiveSubscription(appUserId, productId, transactionId) {
  return findActiveSubscription(appUserId, { productId, transactionId });
}

/** Find any active entitled subscription when a customer restores purchases. */
export function getAnyActiveSubscription(appUserId) {
  return findActiveSubscription(appUserId);
}
