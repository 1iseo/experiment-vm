/* @vm-obfuscate */
function calculateCartTotal(cart, couponCode) {
  let subtotal = 0;
  for (let i = 0; i < cart.items.length; i++) {
    const item = cart.items[i];
    subtotal += item.price * item.quantity;
  }

  let discount = 0;
  if (couponCode === "SAVE10") {
    discount = subtotal * 0.10;
  } else if (couponCode === "FLAT20" && subtotal >= 100) {
    discount = 20;
  }

  const discountedSubtotal = subtotal - discount;
  const tax = discountedSubtotal * 0.0825; // 8.25% tax

  let shipping = 10; // Default shipping
  if (discountedSubtotal >= 50) {
    shipping = 0; // Free shipping on orders over $50
  }

  const grandTotal = discountedSubtotal + tax + shipping;

  return {
    subtotal: subtotal,
    discount: discount,
    tax: Math.round(tax * 100) / 100,
    shipping: shipping,
    total: Math.round(grandTotal * 100) / 100
  };
}

globalThis["__dataset_api__"] = [calculateCartTotal];
