# 05 — Address Management

## Objective
Allow customers to create and manage delivery addresses for their orders.

## Scope

### Initial Address Setup
- Prompt the customer to set a delivery location after registration.
- Request permission to access the device's location.
- Retrieve the current GPS location when permission is granted.
- Display the location on a map.
- Allow the customer to adjust the map pin.
- Require customer confirmation before saving the location.

### Manual Address Entry
- Allow customers to enter their delivery location manually.
- Support cases where GPS is unavailable or permission is denied.

### Address Management
- Add delivery addresses.
- Display saved addresses.
- Edit existing addresses.
- Delete addresses.
- Set a default delivery address.
- Select an address during checkout.

## Business Rules
- Customers can manage only their own addresses.
- An address must be confirmed by the customer before saving.
- Customers can have multiple saved addresses.
- A default address can be selected for future orders.
- GPS permission is optional; manual entry must remain available.

## Acceptance Criteria
- Customers can add an address using GPS.
- Customers can adjust and confirm their map location.
- Customers can add an address manually.
- Customers can view, edit, and delete saved addresses.
- Customers can select a default address.
- Customers can select a delivery address during checkout.
- Address information is associated with the correct customer.