import 'package:chicman/core/auth/secure_session_storage.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  const key = 'sb-abc123-auth-token';
  const session = '{"access_token":"a.b.c","refresh_token":"r"}';

  setUp(() {
    FlutterSecureStorage.setMockInitialValues({});
    SharedPreferences.setMockInitialValues({});
  });

  SecureSessionStorage storage() => SecureSessionStorage(
    persistSessionKey: key,
    storage: const FlutterSecureStorage(),
  );

  test('uses the SDK session key for the project', () {
    expect(supabaseSessionKey('https://abc123.supabase.co'), key);
  });

  test('persists, restores after a restart, and removes the session', () async {
    final first = storage();
    await first.initialize();
    expect(await first.hasAccessToken(), isFalse);
    await first.persistSession(session);

    // A new instance (app restart) restores the same session.
    final restarted = storage();
    await restarted.initialize();
    expect(await restarted.hasAccessToken(), isTrue);
    expect(await restarted.accessToken(), session);

    // Logout.
    await restarted.removePersistedSession();
    expect(await restarted.hasAccessToken(), isFalse);
    expect(await restarted.accessToken(), isNull);
  });

  test('never writes the session to shared_preferences', () async {
    final secure = storage();
    await secure.initialize();
    await secure.persistSession(session);
    final preferences = await SharedPreferences.getInstance();
    expect(preferences.getKeys(), isEmpty);
  });

  test(
    'moves a plaintext session from the SDK default storage, then deletes it',
    () async {
      SharedPreferences.setMockInitialValues({
        key: session,
        'chicman-theme': 'dark',
      });
      final secure = storage();
      await secure.initialize();
      expect(await secure.accessToken(), session);
      final preferences = await SharedPreferences.getInstance();
      expect(preferences.containsKey(key), isFalse);
      // Other preferences are untouched.
      expect(preferences.getString('chicman-theme'), 'dark');
    },
  );

  test('a newer secure session wins over a stale plaintext copy', () async {
    FlutterSecureStorage.setMockInitialValues({key: 'newer'});
    SharedPreferences.setMockInitialValues({key: 'stale'});
    final secure = storage();
    await secure.initialize();
    expect(await secure.accessToken(), 'newer');
    expect((await SharedPreferences.getInstance()).containsKey(key), isFalse);
  });

  test('a failing preferences store does not block startup', () async {
    final secure = SecureSessionStorage(
      persistSessionKey: key,
      storage: const FlutterSecureStorage(),
      legacyPreferences: () async => throw StateError('unavailable'),
    );
    await secure.initialize();
    expect(await secure.hasAccessToken(), isFalse);
  });
}
