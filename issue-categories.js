// Issue categories and types based on the reference images

const ISSUE_CATEGORIES = {
  ORDER_ISSUES: {
    id: 'order_issues',
    label: 'Order Issues',
    icon: '📦',
    types: [
      { id: 'not_received', label: 'I did not receive this order' },
      { id: 'few_missing', label: 'Few item(s) are missing in my order' },
      { id: 'incorrect_wrong', label: 'Item(s) delivered are incorrect or wrong' },
      { id: 'poor_quality', label: 'Item(s) quality is poor' },
      { id: 'spillage', label: 'Item(s) has spillage issue' },
      { id: 'inadequate_portion', label: 'Item(s) portion size is not adequate' }
    ]
  },
  MEMBERSHIP: {
    id: 'membership',
    label: 'Membership & Subscriptions',
    icon: '👑',
    types: [
      { id: 'cancel_membership', label: 'I want to cancel the membership' },
      { id: 'device_limit', label: 'Is there a limit on number of devices?' },
      { id: 'minimum_bill', label: 'Minimum bill value for offers' },
      { id: 'free_delivery_limit', label: 'Limit on free deliveries or discounts' },
      { id: 'club_discounts', label: 'Can I club extra discount with other offers?' },
      { id: 'availability', label: 'Availability in all cities' },
      { id: 'transfer_membership', label: 'Can I cancel, pause or transfer membership?' }
    ]
  },
  DELIVERY: {
    id: 'delivery',
    label: 'Delivery Issues',
    icon: '🚚',
    types: [
      { id: 'safety_incident', label: 'Report a safety incident' },
      { id: 'partner_fraud', label: 'Report a Delivery Partner fraud incident' }
    ]
  },
  PAYMENT_BILLING: {
    id: 'payment_billing',
    label: 'Payment and Billing',
    icon: '💳',
    types: [
      { id: 'payment_query', label: 'Payment and billing related query' },
      { id: 'coupon_query', label: 'I have coupon related query for this order' },
      { id: 'wrong_restaurant', label: 'I paid the bill to the wrong restaurant' }
    ]
  },
  TECHNICAL: {
    id: 'technical',
    label: 'Technical Support',
    icon: '🔧',
    types: [
      { id: 'app_issue', label: 'App not working properly' },
      { id: 'login_issue', label: 'Unable to login' },
      { id: 'payment_failed', label: 'Payment failed but amount deducted' },
      { id: 'order_tracking', label: 'Unable to track order' }
    ]
  },
  GENERAL: {
    id: 'general',
    label: 'General Inquiry',
    icon: '💬',
    types: [
      { id: 'product_info', label: 'Product information' },
      { id: 'store_location', label: 'Store location and timing' },
      { id: 'feedback', label: 'Provide feedback or suggestion' },
      { id: 'other', label: 'Other inquiry' }
    ]
  }
};

// Helper function to get category by id
function getCategoryById(categoryId) {
  return Object.values(ISSUE_CATEGORIES).find(cat => cat.id === categoryId);
}

// Helper function to get type label
function getTypeLabel(categoryId, typeId) {
  const category = getCategoryById(categoryId);
  if (!category) return typeId;
  
  const type = category.types.find(t => t.id === typeId);
  return type ? type.label : typeId;
}

// Get all categories as array
function getAllCategories() {
  return Object.values(ISSUE_CATEGORIES);
}

module.exports = {
  ISSUE_CATEGORIES,
  getCategoryById,
  getTypeLabel,
  getAllCategories
};
