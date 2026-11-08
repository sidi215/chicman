import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geolocator/geolocator.dart';

import '../../../core/storage/shared_preferences_provider.dart';
import '../../auth/application/auth_providers.dart';
import '../domain/address.dart';

/// The customer's saved addresses (`GET /customers/me/addresses`), default
/// first. Reload with `ref.invalidate(addressListProvider)`.
final addressListProvider =
    FutureProvider.autoDispose<AddressOutcome<List<CustomerAddress>>>((
      ref,
    ) async {
      final repository = ref.watch(authRepositoryProvider);
      final token = await repository?.accessToken();
      if (repository == null || token == null) {
        return const AddressOutcome(AddressOutcomeKind.signedOut);
      }
      final outcome = interpretAddressResult(
        await ref
            .read(apiClientProvider)
            .get(
              '/customers/me/addresses',
              accessToken: token,
              decode: addressListFromJson,
            ),
      );
      if (outcome.kind == AddressOutcomeKind.signedOut) {
        await repository.signOut();
      }
      return outcome;
    });

/// Sends an address mutation; reloads the list on success. 401 ends the session.
Future<AddressOutcome<Object?>> sendAddressRequest(
  WidgetRef ref,
  String method,
  String path, [
  Map<String, Object?>? body,
]) async {
  final repository = ref.read(authRepositoryProvider);
  final token = await repository?.accessToken();
  if (repository == null || token == null) {
    return const AddressOutcome(AddressOutcomeKind.signedOut);
  }
  final outcome = interpretAddressResult<Object?>(
    await ref
        .read(apiClientProvider)
        .send(method, path, accessToken: token, body: body, decode: (j) => j),
  );
  if (outcome.kind == AddressOutcomeKind.signedOut) await repository.signOut();
  if (outcome.kind == AddressOutcomeKind.ok) {
    ref.invalidate(addressListProvider);
  }
  return outcome;
}

/// Why the device position could not be read.
enum DeviceLocationFailure {
  serviceDisabled,
  denied,
  deniedForever,
  timeout,
  unavailable,
}

class DeviceLocationResult {
  const DeviceLocationResult.found(PinLocation this.pin) : failure = null;
  const DeviceLocationResult.failed(DeviceLocationFailure this.failure)
    : pin = null;
  final PinLocation? pin;
  final DeviceLocationFailure? failure;
}

typedef DeviceLocator = Future<DeviceLocationResult> Function();

/// Reads the device position once, asking for permission only now (when
/// the customer taps "Utiliser ma position"). Overridden in tests.
final deviceLocatorProvider = Provider<DeviceLocator>((ref) => _geolocate);

Future<DeviceLocationResult> _geolocate() async {
  try {
    if (!await Geolocator.isLocationServiceEnabled()) {
      return const DeviceLocationResult.failed(
        DeviceLocationFailure.serviceDisabled,
      );
    }
    var permission = await Geolocator.checkPermission();
    if (permission == LocationPermission.denied) {
      permission = await Geolocator.requestPermission();
    }
    if (permission == LocationPermission.deniedForever) {
      return const DeviceLocationResult.failed(
        DeviceLocationFailure.deniedForever,
      );
    }
    if (permission == LocationPermission.denied ||
        permission == LocationPermission.unableToDetermine) {
      return const DeviceLocationResult.failed(DeviceLocationFailure.denied);
    }
    final position = await Geolocator.getCurrentPosition(
      locationSettings: const LocationSettings(
        accuracy: LocationAccuracy.high,
        timeLimit: Duration(seconds: 15),
      ),
    );
    return DeviceLocationResult.found(
      PinLocation(
        latitude: position.latitude,
        longitude: position.longitude,
        source: LocationSource.gps,
        accuracyMeters: position.accuracy.isFinite
            ? position.accuracy.round()
            : null,
      ),
    );
  } on TimeoutException {
    return const DeviceLocationResult.failed(DeviceLocationFailure.timeout);
  } on Object {
    return const DeviceLocationResult.failed(DeviceLocationFailure.unavailable);
  }
}

const _promptKey = 'chicman-address-prompt-dismissed';

/// The onboarding prompt's "Plus tard" choice, kept on this device only.
final addressPromptDismissedProvider =
    NotifierProvider<AddressPromptDismissed, bool>(AddressPromptDismissed.new);

class AddressPromptDismissed extends Notifier<bool> {
  @override
  bool build() =>
      ref.watch(sharedPreferencesProvider)?.getBool(_promptKey) ?? false;

  Future<void> dismiss() async {
    state = true;
    try {
      await ref.read(sharedPreferencesProvider)?.setBool(_promptKey, true);
    } on Object {
      // Storage failed: the prompt shows again next launch.
    }
  }
}
