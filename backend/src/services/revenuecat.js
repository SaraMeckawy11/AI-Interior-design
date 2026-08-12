import axios from 'axios';

const REVENUECAT_URL = 'https://api.revenuecat.com/v1/subscribers';

/** Compare Google identifiers with or without a base-plan/purchase-option suffix. */
export function sameStoreProduct(left, right) {
  if (!left || !right) return false;
  const a = String(left);
  const b = String(right);
  return a === b || a.split(':')[0] === b.split(':')[0];
}

/** Fetch RevenueCat's server-side view of one customer. */
export async function getRevenueCatCustomer(appUserId) {
  const apiKey = process.env.REVENUECAT_API_KEY;
  if (!apiKey) {
    const error = new Error('REVENUECAT_API_KEY is not configured.');
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

  return {
    productId: verifiedProductId,
    transactionId: subscription.store_transaction_id || transactionId,
    purchaseDate: subscription.purchase_date,
    expiresDate: subscription.expires_date,
    entitlementId: entitlement[0],
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
