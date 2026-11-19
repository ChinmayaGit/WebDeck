import 'dart:convert';
import 'dart:io';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:webdeck/runtime/link_service.dart';
import 'package:webdeck/runtime/notification_service.dart';
import 'package:webdeck/runtime/settings_service.dart';

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory dirA, dirB;
  late LinkService a, b;
  String? clipA;

  setUp(() async {
    // flutter_test mocks HttpClient (every request → 400); Device Link needs real sockets.
    HttpOverrides.global = null;
    dirA = await Directory.systemTemp.createTemp('link_a_');
    dirB = await Directory.systemTemp.createTemp('link_b_');
    LinkService make(Directory d) {
      Future<Directory> base() async => d;
      final settings = SettingsService(base);
      return LinkService(base, NotificationService(base, settings));
    }

    a = make(dirA)
      ..readClipboard = (() async => null)
      ..writeClipboard = ((t) async => clipA = t);
    b = make(dirB)
      ..readClipboard = (() async => null)
      ..writeClipboard = ((_) async {});
    await a.load();
    await b.load();
    await a.setEnabled(true);
    await b.setEnabled(true);
  });

  tearDown(() async {
    await a.stop();
    await b.stop();
    await dirA.delete(recursive: true);
    await dirB.delete(recursive: true);
  });

  test('pair, message, file, clipboard — and reject forgeries', () async {
    expect(a.running && b.running, isTrue);
    expect(a.port, isNot(b.port));

    // Wrong code is refused.
    a.newPairCode();
    await expectLater(b.pairWith('127.0.0.1', '000000', peerPort: a.port), throwsA(isA<LinkException>()));

    // Correct code pairs both sides with a shared secret.
    final code = a.newPairCode().code;
    final peerA = await b.pairWith('127.0.0.1', code, peerPort: a.port);
    expect(peerA.id, a.deviceId);
    expect(a.pairedPeers.single.id, b.deviceId);
    // The code is single-use.
    await expectLater(b.pairWith('127.0.0.1', code, peerPort: a.port), throwsA(isA<LinkException>()));

    // Signed message arrives in A's inbox.
    await b.send(a.deviceId, 'chat', {'text': 'hello from B'});
    expect(a.inbox(channel: 'chat').single.payload['text'], 'hello from B');
    expect(a.inbox(channel: 'chat').single.peerName, b.deviceName);

    // A forged request (no valid signature) is rejected.
    final forged = await http.post(
      Uri.parse('http://127.0.0.1:${a.port}/link/msg'),
      headers: {'x-link-id': b.deviceId, 'x-link-ts': '${DateTime.now().millisecondsSinceEpoch}', 'x-link-sig': 'deadbeef'},
      body: jsonEncode({'channel': 'chat', 'payload': {'text': 'evil'}}),
    );
    expect(forged.statusCode, 401);
    expect(a.inbox(channel: 'chat').length, 1);

    // File transfer: bytes arrive intact in A's Received folder.
    final src = File(p.join(dirB.path, 'photo.bin'))..writeAsBytesSync(List.generate(300000, (i) => i % 251));
    await b.sendFile(a.deviceId, src.path);
    final got = a.inbox(channel: 'files').single.payload;
    expect(got['name'], 'photo.bin');
    expect(File(got['path'] as String).readAsBytesSync(), src.readAsBytesSync());

    // Clipboard: text shared by B lands on A's clipboard and history.
    final n = await b.shareClipboard('copied on B');
    expect(n, 1);
    expect(clipA, 'copied on B');
    expect(a.clipboardHistory.first['text'], 'copied on B');

    // State survives a restart (paired peers persist).
    final reloaded = LinkService(() async => dirA, NotificationService(() async => dirA, SettingsService(() async => dirA)));
    await reloaded.load();
    expect(reloaded.pairedPeers.single.id, b.deviceId);
    await reloaded.stop();
  });

  test('unpaired devices cannot send', () async {
    await expectLater(b.send('nobody', 'chat', {'text': 'x'}), throwsA(isA<LinkException>()));
    final hello = await http.get(Uri.parse('http://127.0.0.1:${a.port}/link/hello'));
    expect(jsonDecode(hello.body)['id'], a.deviceId);
  });
}
