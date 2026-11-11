import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/features/favorites/domain/favorites.dart';
import 'package:chicman/features/favorites/presentation/favorites_messages.dart';
import 'package:flutter_test/flutter_test.dart';

Map<String, Object?> _summary(String id) => {
  'id': id,
  'name': 'Melhfa',
  'category': 'CLOTHING',
  'brand': null,
  'price': '1500.00',
  'available': true,
  'mainImageUrl': 'http://media.test/$id.jpg',
  'shop': {'id': 's1', 'name': 'Boutique Sahel'},
};

void main() {
  group('favorite list', () {
    test('reads public and hidden products', () {
      final list = FavoriteList.fromJson({
        'items': [
          {
            'productId': 'p1',
            'addedAt': '2026-11-10T10:00:00.000Z',
            'name': 'Melhfa',
            'imageUrl': 'http://media.test/p1.jpg',
            'state': 'AVAILABLE',
            'product': _summary('p1'),
          },
          {
            'productId': 'p2',
            'addedAt': '2026-11-10T09:00:00.000Z',
            'name': 'Archivé',
            'imageUrl': null,
            'state': 'UNAVAILABLE',
            'product': null,
          },
        ],
      });
      expect(list.items.map((item) => item.state), [
        FavoriteState.available,
        FavoriteState.unavailable,
      ]);
      expect(list.items.first.product?.price, '1500.00');
      expect(list.items.first.canOpen, isTrue);
      expect(list.items.last.product, isNull);
      expect(list.items.last.canOpen, isFalse);
      expect(list.productIds, {'p1', 'p2'});
    });

    test('never keeps a price for a hidden or unknown state', () {
      for (final state in ['UNAVAILABLE', 'SOMETHING_NEW']) {
        final item = FavoriteItem.fromJson({
          'productId': 'p1',
          'addedAt': '2026-11-10T10:00:00.000Z',
          'name': 'Melhfa',
          'imageUrl': null,
          'state': state,
          'product': _summary('p1'),
        });
        expect(item.state, FavoriteState.unavailable, reason: state);
        expect(item.product, isNull, reason: state);
      }
    });

    test('puts the product in the path, encoded', () {
      expect(favoritePath('p1'), '/customers/me/favorites/p1');
      expect(favoritePath('a/b'), '/customers/me/favorites/a%2Fb');
    });
  });

  group('interpretFavoriteResult', () {
    test('classifies sessions, outages, and refusals', () {
      const list = FavoriteList([]);
      expect(
        interpretFavoriteResult(const ApiOk(list)),
        isA<FavoritesLoaded>(),
      );
      expect(
        interpretFavoriteResult(const ApiUnauthorized()),
        isA<FavoritesSignedOut>(),
      );
      expect(
        interpretFavoriteResult(const ApiForbidden('ACCOUNT_NOT_BOOTSTRAPPED')),
        isA<FavoritesNotBootstrapped>(),
      );
      FavoriteFailure failureOf(ApiResult<FavoriteList> result) =>
          (interpretFavoriteResult(result) as FavoritesFailed).failure;
      expect(failureOf(const ApiNetworkError()), FavoriteFailure.unavailable);
      expect(
        failureOf(const ApiAuthUnavailable()),
        FavoriteFailure.unavailable,
      );
      expect(
        failureOf(const ApiError(503, 'SERVICE_UNAVAILABLE')),
        FavoriteFailure.unavailable,
      );
      expect(
        failureOf(const ApiError(429, 'RATE_LIMITED')),
        FavoriteFailure.rateLimited,
      );
      expect(
        failureOf(const ApiError(404, 'PRODUCT_NOT_FOUND')),
        FavoriteFailure.productNotFound,
      );
      expect(
        failureOf(const ApiError(409, 'FAVORITE_LIMIT_REACHED')),
        FavoriteFailure.limitReached,
      );
      expect(
        failureOf(const ApiError(500, 'INTERNAL_ERROR')),
        FavoriteFailure.error,
      );
    });
  });

  group('favorite messages', () {
    test('French and Arabic have the same texts, for every failure', () {
      final [fr, ar] = FavoritesMessages.all;
      expect(ar.keys, fr.keys);
      for (final t in FavoritesMessages.all) {
        for (final failure in FavoriteFailure.values) {
          expect(t.failure(failure), isNotEmpty);
        }
        for (final state in FavoriteState.values) {
          expect(t.state(state), isNotEmpty);
        }
        expect(t.add('Robe'), contains('Robe'));
        expect(t.remove('Robe'), contains('Robe'));
        expect(t.guestAdd('Robe'), contains('Robe'));
      }
    });

    test('the limit in the text matches the API limit', () {
      final [fr, ar] = FavoritesMessages.all;
      expect(
        fr.failure(FavoriteFailure.limitReached),
        contains('$favoritesMaxItems'),
      );
      expect(
        ar.failure(FavoriteFailure.limitReached),
        contains('$favoritesMaxItems'),
      );
    });
  });
}
