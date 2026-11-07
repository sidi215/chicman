# Mauritania Fashion Marketplace "chicman"

## Overview

A multi-vendor fashion e-commerce platform designed for the Mauritanian market, connecting customers with registered fashion shops through web and mobile applications. Customers can discover, search, and purchase new clothing, shoes, and fashion accessories from different shops in one marketplace. Sellers can manage their shops, products, inventory, orders, and deliveries, while administrators oversee the platform, approve shops, and manage marketplace activities. The platform aims to simplify online fashion shopping in Mauritania, help local fashion businesses reach more customers, and provide a convenient and trustworthy shopping experience with cash on delivery.

## Goals

1. Build a centralized fashion marketplace that connects customers with registered fashion shops across Mauritania.
2. Provide customers with a simple and convenient shopping experience through web and mobile applications.
3. Enable fashion shops to establish an online presence and independently manage their products, stock, orders, and deliveries.
4. Establish a trusted marketplace through shop verification, controlled seller registration, and transparent order management.
5. Support affordable, mid-range, and premium fashion products.
6. Create a scalable foundation that can support future business growth and additional services.

## Core User Flow

### Customer Flow

1. Customer discovers the marketplace through the web or mobile application.
2. Customer browses fashion categories and searches for products.
3. Customer views product details, prices, images, and seller information.
4. Customer adds products from one or multiple shops to the shopping cart.
5. Customer signs up with an email address and a password (no phone on the sign-up form), confirms the email address through the confirmation link (on any device), then completes account setup by entering a phone number (contact information).
6. Customer provides a delivery location using GPS detection or manual entry and confirms the location.
7. Customer reviews their cart, selects a delivery address, and places an order.
8. The marketplace creates separate seller orders under the customer's overall order.
9. Each seller independently accepts or rejects their part of the order.
10. Customer receives notifications about order updates.
11. Sellers arrange delivery and collect payment directly from customers through cash on delivery.
12. Customer receives their products.

### Seller Flow

1. Shop owner registers their shop on the marketplace.
2. Shop submits the required business information for verification.
3. Administrator reviews and approves or rejects the shop application.
4. Approved shop accesses its seller dashboard.
5. Seller creates and manages product listings.
6. Seller manages product prices, images, sizes, colors, and stock.
7. Seller receives orders containing their products.
8. Seller accepts or rejects each order.
9. Seller prepares accepted orders and manages delivery.
10. Seller collects payment directly from the customer upon delivery.

### Administrator Flow

1. Administrator accesses the administration dashboard.
2. Reviews and manages shop registration applications.
3. Approves or rejects seller accounts.
4. Oversees customers, sellers, products, and orders.
5. Monitors marketplace activities and handles reported issues.
6. Manages platform categories and general marketplace settings.

## Features

### Customer Management

- Customer registration using email and password, with a required phone number entered during account setup as contact information (not verified in the initial release; editable in the profile).
- Mandatory email confirmation during registration.
- Customer login with email and password, and account management. Sign-in email changes are not supported in the first release.
- Password recovery by email.
- Bot protection (Cloudflare Turnstile CAPTCHA) on registration, login, and password recovery.
- Customer profile management.
- Delivery location detection through GPS.
- Manual delivery location entry when GPS is unavailable or permission is denied.
- Location confirmation before saving.
- Ability to edit and add multiple delivery addresses.

### Product Discovery

- Fashion product catalog.
- Product categories: clothing, shoes, and fashion accessories.
- Product search and filtering.
- Product details and image galleries.
- Product size and color variations.
- Seller/shop information.
- Product ratings and reviews.
- Favorites and wishlist.
- Support for affordable, mid-range, and premium products.

### Shopping Cart and Checkout

- Add, update, and remove cart items.
- Shopping cart for multiple sellers.
- Guest browsing and cart functionality.
- Merge guest cart with registered customer cart upon signup.
- Customer authentication required before placing orders.
- Delivery address selection.
- Delivery fee calculation.
- Order summary and confirmation.
- Cash-on-delivery checkout.

### Seller Management

- Shop registration and application.
- Administrator approval workflow.
- Seller dashboard.
- Shop profile management.
- Product creation and management.
- Product image uploads.
- Stock and inventory management.
- Product size and color management.
- Seller-specific order management.
- Independent order acceptance and rejection.
- Seller-managed delivery.
- Seller-managed returns and exchanges.

### Order Management

- Centralized customer order management.
- Separate seller orders for multi-shop purchases.
- Independent seller order processing.
- Order acceptance and rejection.
- Customer order tracking through status updates.
- Customer cancellation before shipment.
- Order status notifications.
- Delivery status management.
- Failed delivery management.
- Order history.

### Delivery Management

- Seller-managed deliveries.
- Seller-defined delivery fees.
- Customer delivery location management.
- GPS-based location detection.
- Manual location selection.
- Delivery status updates.
- Cash collection directly by sellers.
- Failed delivery reporting and handling.

### Notifications

- Account emails: email confirmation and password recovery (sent by Supabase Auth).
- Order confirmation notifications.
- Seller acceptance and rejection notifications.
- Order status updates.
- Delivery notifications.
- Important account notifications.

### Administration

- Admin dashboard.
- Seller/shop application management.
- Customer management.
- Seller management.
- Product and category management.
- Order monitoring.
- Reported issue management.
- Marketplace configuration.
- Platform activity overview.

## Scope

### In Scope

- Multi-vendor fashion marketplace.
- Web application built with Next.js.
- Mobile applications built with Flutter.
- Shared backend using Node.js and Express.
- Supabase Auth for email + password authentication, email confirmation, and password recovery.
- PostgreSQL as the primary database.
- S3-compatible object storage for product images and media.
- Meilisearch for product search.
- Redis for caching and background processing.
- Customer, seller, and administrator experiences.
- Registered shops only.
- New clothing, shoes, and fashion accessories only.
- Cash on delivery as the initial payment method.
- Seller-managed deliveries and payment collection.
- French and Arabic localization with RTL support.
- MRU currency support.

### Out of Scope

- Online payment gateway integration in the initial version.
- Automated seller payouts and marketplace payment distribution.
- Individual private sellers.
- Second-hand products.
- Products outside the fashion industry.
- International marketplace operations and shipping.
- Marketplace-managed delivery fleet.
- In-platform customer-seller chat.
- AI-powered recommendations in the initial version.
- Loyalty programs and subscription services.
- Advanced marketing automation.
- Native desktop applications.
- Phone-number authentication, phone OTP verification, and SMS delivery in the initial version (phone verification may be added later).

## Success Criteria

1. Customers can register using their email address and password, confirm their email, and access their accounts. Their phone number is collected as contact information.
2. Customers can browse products without registering but must authenticate before placing orders.
3. Customers can discover and purchase clothing, shoes, and fashion accessories.
4. Customers can add products from multiple shops to one cart and complete a single checkout.
5. The marketplace correctly creates separate seller orders from a multi-shop customer order.
6. Sellers can register their shops, but cannot sell until approved by an administrator.
7. Approved sellers can manage products, prices, inventory, and orders.
8. Sellers can independently accept or reject their orders.
9. Customers receive notifications about important order updates.
10. Sellers can manage deliveries and collect cash payments directly from customers.
11. Customers can manage delivery addresses using GPS detection or manual entry.
12. Web and mobile applications provide consistent functionality and visual identity.
13. The platform supports French and Arabic, including proper RTL layouts.
14. Product prices and delivery fees are displayed consistently in MRU.
15. Administrators can manage shops, customers, products, and marketplace orders from a central dashboard.
