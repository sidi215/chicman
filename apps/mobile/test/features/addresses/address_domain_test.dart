import 'package:chicman/core/network/api_client.dart';
import 'package:chicman/features/addresses/domain/address.dart';
import 'package:chicman/features/addresses/presentation/address_messages.dart';
import 'package:flutter_test/flutter_test.dart';

const _gps = PinLocation(
  latitude: 18.1012345678,
  longitude: -15.9987654321,
  source: LocationSource.gps,
  accuracyMeters: 12,
);

AddressFormValues _values({String label = ' Maison ', String phone = ''}) => {
  AddressField.label: label,
  AddressField.city: 'Nouakchott',
  AddressField.district: 'Tevragh Zeina',
  AddressField.landmark: 'Portail bleu',
  AddressField.deliveryPhone: phone,
};

final _saved = CustomerAddress.fromJson({
  'id': 'a1',
  'label': 'Maison',
  'city': 'Nouakchott',
  'district': 'Tevragh Zeina',
  'landmark': 'Portail bleu',
  'deliveryPhone': null,
  'latitude': 18.101235,
  'longitude': -15.998765,
  'locationSource': 'GPS',
  'accuracyMeters': 12,
  'isDefault': true,
});

void main() {
  test('create body: confirmed, normalized, allowlisted', () {
    final result = buildAddressCreate(_values(), _gps);
    expect(result.isValid, isTrue);
    expect(result.body, {
      'label': 'Maison',
      'city': 'Nouakchott',
      'district': 'Tevragh Zeina',
      'landmark': 'Portail bleu',
      'latitude': 18.101235,
      'longitude': -15.998765,
      'locationSource': 'GPS',
      'accuracyMeters': 12,
      'locationConfirmed': true,
    });
    final manual = buildAddressCreate(
      _values(label: '', phone: '46000001'),
      const PinLocation.manual(18.09, -15.97),
    );
    expect(manual.body['locationSource'], 'MANUAL');
    expect(manual.body.containsKey('accuracyMeters'), isFalse);
    expect(manual.body.containsKey('label'), isFalse);
    expect(manual.body['deliveryPhone'], '+22246000001');
  });

  test('requires a pin in Mauritania and valid details', () {
    final empty = buildAddressCreate({}, null);
    expect(empty.locationError, LocationError.missing);
    expect(empty.errors, {
      AddressField.city: AddressFieldError.required,
      AddressField.district: AddressFieldError.required,
      AddressField.landmark: AddressFieldError.required,
    });
    expect(
      buildAddressCreate(
        _values(),
        const PinLocation.manual(48.85, 2.35),
      ).locationError,
      LocationError.outsideServiceArea,
    );
    final bad = buildAddressCreate({
      ..._values(phone: '12'),
      AddressField.landmark: 'x' * 301,
      AddressField.city: 'A\u0007',
    }, _gps);
    expect(bad.errors, {
      AddressField.landmark: AddressFieldError.tooLong,
      AddressField.city: AddressFieldError.invalid,
      AddressField.deliveryPhone: AddressFieldError.invalidPhone,
    });
    expect(bad.body, isEmpty);
  });

  test('update: only changed fields; a moved pin is re-confirmed', () {
    expect(
      buildAddressUpdate(addressFormValues(_saved), _saved.pin, _saved).body,
      isEmpty,
    );
    expect(
      buildAddressUpdate(
        {
          ...addressFormValues(_saved),
          AddressField.label: '',
          AddressField.landmark: 'Nouveau',
        },
        _saved.pin,
        _saved,
      ).body,
      {'label': null, 'landmark': 'Nouveau'},
    );
    expect(
      buildAddressUpdate(
        addressFormValues(_saved),
        const PinLocation.manual(18.2, -15.9),
        _saved,
      ).body,
      {
        'latitude': 18.2,
        'longitude': -15.9,
        'locationSource': 'MANUAL',
        'locationConfirmed': true,
      },
    );
  });

  test('maps API outcomes', () {
    AddressOutcomeKind kind(ApiResult<Object?> r) =>
        interpretAddressResult(r).kind;
    expect(
      kind(const ApiError(409, 'ADDRESS_LIMIT_REACHED')),
      AddressOutcomeKind.limitReached,
    );
    expect(
      kind(const ApiError(400, 'ADDRESS_OUTSIDE_SERVICE_AREA')),
      AddressOutcomeKind.outsideServiceArea,
    );
    expect(
      kind(const ApiError(404, 'ADDRESS_NOT_FOUND')),
      AddressOutcomeKind.notFound,
    );
    expect(
      kind(const ApiForbidden('FORBIDDEN')),
      AddressOutcomeKind.notBootstrapped,
    );
    expect(kind(const ApiUnauthorized()), AddressOutcomeKind.signedOut);
  });

  test('French and Arabic texts have the same keys', () {
    expect(AddressMessages.keys('ar'), AddressMessages.keys('fr'));
  });
}
