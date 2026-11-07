import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:supabase_flutter/supabase_flutter.dart';

/// Supabase session persistence in platform secure storage (spec 03,
/// Abuse Protection and Sessions): Android Keystore-backed encryption and the
/// iOS Keychain, instead of the SDK default (plain `shared_preferences`).
///
/// On first use it moves a session saved by the SDK default storage into
/// secure storage and deletes the plaintext copy, so a signed-in user stays
/// signed in. Storage errors never crash the app: a session that cannot be
/// read is treated as signed out. Session contents are never logged.
class SecureSessionStorage extends LocalStorage {
  SecureSessionStorage({
    required this.persistSessionKey,
    FlutterSecureStorage? storage,
    Future<SharedPreferences?> Function()? legacyPreferences,
  }) : _storage = storage ?? defaultSecureStorage,
       _legacyPreferences = legacyPreferences ?? _sharedPreferences;

  /// Same key as the SDK default (`sb-<project-ref>-auth-token`).
  final String persistSessionKey;
  final FlutterSecureStorage _storage;
  final Future<SharedPreferences?> Function() _legacyPreferences;

  /// iOS: readable after the first unlock (background token refresh), never
  /// synced to iCloud or restored to another device. Android: default
  /// AES-GCM storage with a Keystore-wrapped key (API 24+).
  static const defaultSecureStorage = FlutterSecureStorage(
    aOptions: AndroidOptions(),
    iOptions: IOSOptions(
      accessibility: KeychainAccessibility.first_unlock_this_device,
    ),
  );

  static Future<SharedPreferences?> _sharedPreferences() async {
    try {
      return await SharedPreferences.getInstance();
    } on Object {
      return null;
    }
  }

  @override
  Future<void> initialize() async {
    // One-time migration from the SDK's plaintext default storage.
    try {
      final preferences = await _legacyPreferences();
      final legacy = preferences?.getString(persistSessionKey);
      if (preferences == null || legacy == null) return;
      final existing = await _storage.read(key: persistSessionKey);
      if (existing == null) {
        await _storage.write(key: persistSessionKey, value: legacy);
      }
      await preferences.remove(persistSessionKey);
    } on Object {
      debugPrint('Session storage migration skipped.');
    }
  }

  @override
  Future<bool> hasAccessToken() async {
    try {
      return await _storage.containsKey(key: persistSessionKey);
    } on Object {
      return false;
    }
  }

  @override
  Future<String?> accessToken() async {
    try {
      return await _storage.read(key: persistSessionKey);
    } on Object {
      debugPrint('Stored session unreadable; signing out locally.');
      return null;
    }
  }

  @override
  Future<void> removePersistedSession() async {
    try {
      await _storage.delete(key: persistSessionKey);
    } on Object {
      debugPrint('Stored session could not be deleted.');
    }
  }

  @override
  Future<void> persistSession(String persistSessionString) =>
      _storage.write(key: persistSessionKey, value: persistSessionString);
}

/// The SDK's session key for a project URL (`sb-<project-ref>-auth-token`).
String supabaseSessionKey(String supabaseUrl) =>
    'sb-${Uri.parse(supabaseUrl).host.split('.').first}-auth-token';
