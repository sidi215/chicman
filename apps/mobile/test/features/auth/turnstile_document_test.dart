import 'package:chicman/features/auth/presentation/turnstile_field.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('embeds the public site key and language as JSON strings', () {
    final html = turnstileDocument(siteKey: '0xSITEKEY', language: 'ar');
    expect(html, contains('sitekey: "0xSITEKEY"'));
    expect(html, contains('language: "ar"'));
    expect(html, contains('https://challenges.cloudflare.com/turnstile/v0/api.js'));
    expect(html, contains("post('token:' + t)"));
  });

  test('a malicious key cannot break out of the script', () {
    final html = turnstileDocument(siteKey: '"});alert(1);//', language: 'xx');
    expect(html, contains(r'sitekey: "\"});alert(1);//"'));
    expect(html, contains('language: "fr"'));
  });
}
