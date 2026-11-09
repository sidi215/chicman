import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/features/cart/domain/cart.dart';
import 'package:flutter_test/flutter_test.dart';

CartItem _item({
  int quantity = 2,
  List<CartIssue> issues = const [],
  String unitPrice = '1500.00',
  bool purchasable = true,
}) => CartItem(
  id: 'i1',
  productId: 'p1',
  name: 'Melhfa',
  imageUrl: null,
  size: null,
  color: null,
  quantity: quantity,
  unitPrice: unitPrice,
  subtotal: '0.00',
  purchasable: purchasable,
  issues: issues,
);

void main() {
  group('quantity controls (same rules as the web)', () {
    void expectControls(CartItem item, int? down, int? up, int? correct) {
      final controls = item.controls;
      expect(controls.decreaseTo, down);
      expect(controls.increaseTo, up);
      expect(controls.correctTo, correct);
    }

    test('steps by one, and never below one', () {
      expectControls(_item(quantity: 3), 2, 4, null);
      expectControls(_item(quantity: 1), null, 2, null);
    });

    test('offers only the available quantity on a line above the stock', () {
      expectControls(
        _item(
          quantity: 5,
          issues: const [
            CartIssue(CartIssueCode.insufficientStock, availableQuantity: 2),
          ],
        ),
        2,
        null,
        2,
      );
    });

    test('offers nothing on a sold-out or remove-only line', () {
      expectControls(
        _item(
          issues: const [
            CartIssue(CartIssueCode.insufficientStock, availableQuantity: 0),
          ],
        ),
        null,
        null,
        null,
      );
      for (final code in [
        CartIssueCode.shopUnavailable,
        CartIssueCode.productArchived,
        CartIssueCode.productUnpublished,
        CartIssueCode.variantUnavailable,
        CartIssueCode.unknown,
      ]) {
        expectControls(_item(issues: [CartIssue(code)]), null, null, null);
      }
    });

    test('keeps normal controls when only the price changed', () {
      expectControls(
        _item(
          issues: const [
            CartIssue(CartIssueCode.priceChanged, previousPrice: '1.00'),
          ],
        ),
        1,
        3,
        null,
      );
    });
  });

  test('links to the product only while its page exists', () {
    expect(_item().canOpenProduct, isTrue);
    expect(
      _item(
        issues: const [CartIssue(CartIssueCode.variantUnavailable)],
      ).canOpenProduct,
      isTrue,
    );
    expect(
      _item(
        issues: const [CartIssue(CartIssueCode.productArchived)],
      ).canOpenProduct,
      isFalse,
    );
  });

  test('acknowledges the current price, never the previous one', () {
    expect(_item().priceToAccept, isNull);
    expect(
      _item(
        unitPrice: '150.00',
        issues: const [
          CartIssue(CartIssueCode.priceChanged, previousPrice: '100.00'),
        ],
      ).priceToAccept,
      '150.00',
    );
  });

  test('never sends a price, a shop, or an owner when adding', () {
    expect(addItemBody('p1', 'v1', 1), {
      'productId': 'p1',
      'variantId': 'v1',
      'quantity': 1,
    });
    expect(addItemBody('p1', null, 1), {'productId': 'p1', 'quantity': 1});
  });

  test('an unknown issue code from a newer API is treated as remove-only', () {
    final issue = CartIssue.fromJson(const {'code': 'SOMETHING_NEW'});
    expect(issue.code, CartIssueCode.unknown);
    expect(issue.code.removeOnly, isTrue);
  });

  test('caps the badge', () {
    expect(cartBadge(99), '99');
    expect(cartBadge(100), '99+');
  });

  group('interpretCartResult', () {
    CartFailure? failureOf(ApiResult<Cart> result) =>
        switch (interpretCartResult(result)) {
          CartFailed(:final failure) => failure,
          _ => null,
        };

    test('separates signed-out, account setup, and temporary failures', () {
      expect(
        interpretCartResult(const ApiUnauthorized<Cart>()),
        isA<CartSignedOut>(),
      );
      expect(
        interpretCartResult(const ApiForbidden<Cart>('X')),
        isA<CartNotBootstrapped>(),
      );
      expect(failureOf(const ApiNetworkError<Cart>()), CartFailure.unavailable);
      expect(
        failureOf(const ApiAuthUnavailable<Cart>()),
        CartFailure.unavailable,
      );
      expect(
        failureOf(const ApiError<Cart>(503, 'X')),
        CartFailure.unavailable,
      );
      expect(
        failureOf(const ApiError<Cart>(429, 'X')),
        CartFailure.rateLimited,
      );
    });

    test('maps each stable code, and an unknown one to a generic failure', () {
      const failures = {
        'CART_INSUFFICIENT_STOCK': CartFailure.insufficientStock,
        'CART_VARIANT_REQUIRED': CartFailure.variantRequired,
        'CART_VARIANT_NOT_FOUND': CartFailure.variantNotFound,
        'CART_ITEM_NOT_FOUND': CartFailure.itemNotFound,
        'CART_ITEM_UNAVAILABLE': CartFailure.itemUnavailable,
        'CART_PRICE_CHANGED': CartFailure.priceChanged,
        'CART_LIMIT_REACHED': CartFailure.limitReached,
        'PRODUCT_NOT_FOUND': CartFailure.productNotFound,
        'SOMETHING_NEW': CartFailure.error,
      };
      failures.forEach((code, failure) {
        expect(failureOf(ApiError<Cart>(409, code)), failure, reason: code);
      });
    });
  });
}
