import 'dart:convert';
import 'dart:typed_data';

import 'package:chicman/features/shop/application/shop_providers.dart';
import 'package:chicman/features/shop/domain/shop.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;

import '../auth/fakes.dart';

Map<String, Object?> shopJson({
  String status = 'APPROVED',
  Map<String, Object?>? rejection,
  Map<String, Object?>? changeRequest,
  String? whatsappPhone,
}) => {
  'id': 's1',
  'status': status,
  'shopName': 'Maison Lalla',
  'description': 'Voiles',
  'contactPhone': '+22236000001',
  'whatsappPhone': whatsappPhone,
  'city': 'Nouakchott',
  'address': 'Ksar',
  'logoUrl': null,
  'createdAt': '2026-11-07T10:00:00.000Z',
  'updatedAt': '2026-11-07T10:00:00.000Z',
  'latestDecision': {
    'type': 'APPLICATION_APPROVED',
    'decidedAt': '2026-11-07T11:00:00.000Z',
  },
  'rejection': rejection,
  'changeRequest': changeRequest,
};

final _png = Uint8List.fromList([
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0,
  0,
  0,
  0,
]);

void main() {
  final approved = OwnerShop.fromJson(shopJson());

  test(
    'parses the owner view (status, decision, rejection, change request)',
    () {
      final rejected = OwnerShop.fromJson(
        shopJson(
          status: 'REJECTED',
          rejection: {
            'applicantReason': 'Adresse incomplète',
            'rejectedAt': '2026-11-07T12:00:00.000Z',
          },
          changeRequest: {
            'id': 'cr1',
            'proposedShopName': null,
            'proposedCity': 'Rosso',
            'status': 'REJECTED',
            'submittedAt': '2026-11-07T09:00:00.000Z',
            'decidedAt': '2026-11-07T09:30:00.000Z',
          },
        ),
      );
      expect(rejected.status, ShopStatus.rejected);
      expect(rejected.rejectionReason, 'Adresse incomplète');
      expect(rejected.latestDecision, ShopDecisionType.applicationApproved);
      expect(rejected.changeRequest?.status, ChangeRequestStatus.rejected);
      expect(rejected.changeRequest?.proposedCity, 'Rosso');
    },
  );

  test('the application validates and normalizes every field', () {
    final ok = buildShopCreate({
      ShopField.shopName: ' Maison ',
      ShopField.description: 'Voiles\r\nmelhfas',
      ShopField.contactPhone: '36 00 00 01',
      ShopField.whatsappPhone: '',
      ShopField.city: 'Atar',
      ShopField.address: 'Centre',
    });
    expect(ok.body, {
      'shopName': 'Maison',
      'description': 'Voiles\nmelhfas',
      'contactPhone': '+22236000001',
      'city': 'Atar',
      'address': 'Centre',
    });
    final bad = buildShopCreate({
      ShopField.shopName: 'x' * 101,
      ShopField.description: '',
      ShopField.contactPhone: '12',
      ShopField.whatsappPhone: 'abc',
      ShopField.city: 'A\u0007',
      ShopField.address: ' ',
    });
    expect(bad.errors, {
      ShopField.shopName: ShopFieldError.tooLong,
      ShopField.description: ShopFieldError.required,
      ShopField.contactPhone: ShopFieldError.invalidPhone,
      ShopField.whatsappPhone: ShopFieldError.invalidPhone,
      ShopField.city: ShopFieldError.invalid,
      ShopField.address: ShopFieldError.required,
    });
    expect(bad.body, isEmpty);
  });

  test(
    'an approved shop edits only immediate fields; shopName/city never go in a PATCH',
    () {
      expect(directlyEditableFields(ShopStatus.approved), [
        ShopField.description,
        ShopField.contactPhone,
        ShopField.whatsappPhone,
        ShopField.address,
      ]);
      expect(directlyEditableFields(ShopStatus.suspended), isEmpty);
      final values = {
        ...shopFormValues(approved),
        ShopField.shopName: 'Autre',
        ShopField.description: 'Nouvelle',
        ShopField.whatsappPhone: '46000001',
      };
      expect(buildShopUpdate(values, approved).body, {
        'description': 'Nouvelle',
        'whatsappPhone': '+22246000001',
      });
      expect(buildShopUpdate(shopFormValues(approved), approved).body, isEmpty);
      final withWhatsapp = OwnerShop.fromJson(
        shopJson(whatsappPhone: '+22246000001'),
      );
      expect(
        buildShopUpdate({
          ...shopFormValues(withWhatsapp),
          ShopField.whatsappPhone: ' ',
        }, withWhatsapp).body,
        {'whatsappPhone': null},
      );
    },
  );

  test('a change request carries only differing values', () {
    expect(buildChangeRequest('Maison Lalla', 'Rosso', approved).body, {
      'city': 'Rosso',
    });
    expect(
      buildChangeRequest('Maison Lalla', 'Nouakchott', approved).body,
      isEmpty,
    );
    expect(buildChangeRequest('', 'Rosso', approved).errors, {
      ShopField.shopName: ShopFieldError.required,
    });
  });

  test('detects JPEG, PNG, and WebP by signature only', () {
    expect(detectLogoType(_png), 'image/png');
    expect(
      detectLogoType(Uint8List.fromList([0xff, 0xd8, 0xff, 0xe0])),
      'image/jpeg',
    );
    expect(
      detectLogoType(
        Uint8List.fromList(utf8.encode('RIFF\x00\x00\x00\x00WEBPVP8 ')),
      ),
      'image/webp',
    );
    expect(
      detectLogoType(Uint8List.fromList(utf8.encode('<svg></svg>'))),
      isNull,
    );
    expect(detectLogoType(Uint8List.fromList(utf8.encode('GIF89a'))), isNull);
  });

  group('logo upload', () {
    test(
      'requests, PUTs to storage without the token, and completes (retrying in-progress)',
      () async {
        final requests = <http.Request>[];
        var completes = 0;
        final api = routedApi({
          'POST /sellers/me/shop/logo/uploads': (_) => (
            201,
            {
              'uploadId': 'u1',
              'uploadUrl':
                  'http://storage.test/chicman-uploads/shop-logos/s1/u1?X-Amz-Signature=x',
              'method': 'PUT',
              'headers': {'Content-Type': 'image/png', 'Content-Length': '12'},
              'expiresAt': '2026-11-07T10:05:00.000Z',
            },
          ),
          'PUT /chicman-uploads/shop-logos/s1/u1': (_) => (200, null),
          'POST /sellers/me/shop/logo/uploads/u1/complete': (_) =>
              ++completes == 1
              ? (
                  409,
                  {
                    'error': {'code': 'LOGO_COMPLETION_IN_PROGRESS'},
                  },
                )
              : (200, {'logoUrl': 'http://media.test/x.png'}),
        }, requests: requests);
        final outcome = await uploadShopLogo(
          api: api,
          accessToken: () async => 'access-token',
          bytes: _png,
          sleep: (_) async {},
        );
        expect(outcome.kind, LogoUploadKind.ok);
        expect(jsonDecode(requests[0].body), {
          'contentType': 'image/png',
          'contentLength': 12,
        });
        expect(requests[1].method, 'PUT');
        expect(requests[1].url.host, 'storage.test');
        expect(requests[1].headers['authorization'], isNull);
        expect(requests[1].headers['content-type'], 'image/png');
        expect(requests[1].bodyBytes, _png);
        expect(completes, 2);
      },
    );

    test('refuses non-images and files over 15 MB before any request', () async {
      final requests = <http.Request>[];
      final api = routedApi({}, requests: requests);
      expect(
        (await uploadShopLogo(
          api: api,
          accessToken: () async => 't',
          bytes: Uint8List.fromList(utf8.encode('<svg/>')),
        )).kind,
        LogoUploadKind.unsupportedType,
      );
      final big = Uint8List(logoMaxBytes + 1)..setAll(0, _png);
      expect(
        (await uploadShopLogo(
          api: api,
          accessToken: () async => 't',
          bytes: big,
        )).kind,
        LogoUploadKind.tooLarge,
      );
      expect(requests, isEmpty);
    });

    test('maps the server rejection code', () async {
      final api = routedApi({
        'POST /sellers/me/shop/logo/uploads': (_) => (
          201,
          {
            'uploadId': 'u1',
            'uploadUrl': 'http://storage.test/b/k',
            'method': 'PUT',
            'headers': {},
            'expiresAt': '',
          },
        ),
        'PUT /b/k': (_) => (200, null),
        'POST /sellers/me/shop/logo/uploads/u1/complete': (_) => (
          422,
          {
            'error': {'code': 'LOGO_TOO_LARGE_DIMENSIONS'},
          },
        ),
      });
      final outcome = await uploadShopLogo(
        api: api,
        accessToken: () async => 't',
        bytes: _png,
      );
      expect(outcome.kind, LogoUploadKind.rejected);
      expect(outcome.code, 'LOGO_TOO_LARGE_DIMENSIONS');
    });
  });
}
