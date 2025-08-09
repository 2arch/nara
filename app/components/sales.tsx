"use client";

import React, { useState } from 'react';
import { loadStripe } from '@stripe/stripe-js';
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from '@stripe/react-stripe-js';

// Make sure to call `loadStripe` outside of a component’s render to avoid
// recreating the `Stripe` object on every render.
// Replace with your actual publishable key
const stripePromise = loadStripe(process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || 'pk_test_TYooMQauvdEDq542SGqUoBMP');

const CheckoutForm = () => {
  const stripe = useStripe();
  const elements = useElements();
  const [error, setError] = useState<string | null>(null);
  const [succeeded, setSucceeded] = useState(false);
  const [processing, setProcessing] = useState(false);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setProcessing(true);

    if (!stripe || !elements) {
      // Stripe.js has not yet loaded.
      // Make sure to disable form submission until Stripe.js has loaded.
      return;
    }

    const cardElement = elements.getElement(CardElement);

    if (!cardElement) {
        setError("Card details not found.");
        setProcessing(false);
        return;
    }

    // In a real application, you would create a PaymentIntent on your server
    // and then confirm it here. For this example, we'll simulate a successful payment.
    // Replace this with actual server-side logic for creating PaymentIntent
    try {
        // Simulate a successful payment for demonstration purposes
        // In a real app, you'd send cardElement.token or cardElement.paymentMethod to your backend
        // and your backend would interact with Stripe API to create a PaymentIntent
        console.log("Simulating payment success...");
        await new Promise(resolve => setTimeout(resolve, 2000)); // Simulate network delay
        setSucceeded(true);
        setError(null);
    } catch (err: any) {
        setError(err.message || "An unexpected error occurred.");
        setSucceeded(false);
    } finally {
        setProcessing(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="bg-gray-800 p-8 rounded-lg shadow-md w-96 mt-8">
      <h2 className="text-2xl font-bold text-white mb-6 text-center">Payment Information</h2>
      <CardElement
        options={{
          style: {
            base: {
              fontSize: '16px',
              color: '#fff',
              ':': {
                color: '#aab7c4',
              },
            },
            invalid: {
              color: '#fa755a',
              iconColor: '#fa755a',
            },
          },
        }}
        className="p-3 border border-gray-700 rounded-md mb-4"
      />
      <button
        type="submit"
        disabled={!stripe || processing || succeeded}
        className="w-full bg-purple-600 text-white py-2 px-4 rounded-md hover:bg-purple-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {processing ? "Processing..." : "Pay $10.00"}
      </button>
      {error && <div className="text-red-500 text-xs italic mt-4 text-center">{error}</div>}
      {succeeded && <div className="text-green-500 text-xs italic mt-4 text-center">Payment Succeeded!</div>}
    </form>
  );
};

const StripePayment = () => {
  return (
    <Elements stripe={stripePromise}>
      <CheckoutForm />
    </Elements>
  );
};

export default StripePayment;