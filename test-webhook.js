// Test webhook locally
const webhookData = {
  id: "evt_test",
  object: "event",
  type: "checkout.session.completed",
  data: {
    object: {
      id: "cs_test_123",
      metadata: {
        userId: "az3fZl5MXaURpcOwHLpfDVQjZte2",
        plan: "pro",
        interval: "monthly"
      },
      subscription: "sub_test_123"
    }
  }
};

// Test without signature verification first
fetch('https://www.nara.ws/api/stripe/webhook', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'stripe-signature': 'test' // dummy signature
  },
  body: JSON.stringify(webhookData)
})
.then(res => res.json())
.then(data => console.log('Response:', data))
.catch(err => console.error('Error:', err));