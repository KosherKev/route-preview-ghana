import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:route_preview/api/address_check.dart';
import 'package:route_preview/api/preview_api.dart';
import 'package:route_preview/api/step_tracker.dart';
import 'package:route_preview/request/request_screen.dart';
import 'package:route_preview/request/settings_store.dart';
import 'package:shared_preferences/shared_preferences.dart';

InternetAddress _ip(String s) => InternetAddress(s);

PreviewApi _api(Future<List<InternetAddress>> Function(String) resolver, {http.Response? health}) => PreviewApi(
      'http://api.example.ts.net:8080',
      client: MockClient((r) async => health ?? http.Response('{"ok":true}', 200)),
      resolver: resolver,
    );

void main() {
  group('classifyAddress', () {
    test('tailnet range 100.64.0.0/10 and its edges', () {
      for (final a in ['100.64.0.1', '100.101.2.3', '100.127.255.254']) {
        expect(classifyAddress(_ip(a)), AddressKind.tailnet, reason: a);
      }
      for (final a in ['100.63.255.255', '100.128.0.1']) {
        expect(classifyAddress(_ip(a)), AddressKind.public, reason: '$a is just outside the range');
      }
      expect(classifyAddress(_ip('fd7a:115c:a1e0::1')), AddressKind.tailnet, reason: 'Tailscale IPv6');
    });

    test('private LAN, loopback and link-local', () {
      for (final a in ['10.0.0.5', '172.16.0.1', '172.31.255.1', '192.168.1.20', '127.0.0.1', '169.254.3.4', '::1', 'fd00::1', 'fe80::1']) {
        expect(classifyAddress(_ip(a)), AddressKind.privateLan, reason: a);
      }
      expect(classifyAddress(_ip('172.32.0.1')), AddressKind.public);
      expect(classifyAddress(_ip('::ffff:192.168.1.5')), AddressKind.privateLan);
    });

    test('public addresses', () {
      for (final a in ['8.8.8.8', '154.160.1.1', '2606:4700::1111', '::ffff:8.8.8.8']) {
        expect(classifyAddress(_ip(a)), AddressKind.public, reason: a);
      }
    });
  });

  group('resolvedLine and addressWarning', () {
    test('shows the first three addresses and counts the rest', () {
      expect(resolvedLine([_ip('100.64.0.1')]), 'resolved to 100.64.0.1');
      expect(resolvedLine([_ip('10.0.0.1'), _ip('10.0.0.2'), _ip('10.0.0.3'), _ip('10.0.0.4'), _ip('10.0.0.5')]), 'resolved to 10.0.0.1, 10.0.0.2, 10.0.0.3 (+2 more)');
    });

    test('warns when any address is public, not for tailnet or private', () {
      expect(addressWarning([_ip('100.100.1.1')]), isNull);
      expect(addressWarning([_ip('192.168.0.9')]), isNull);
      expect(addressWarning([_ip('100.100.1.1'), _ip('8.8.8.8')]), kPublicAddressWarning);
      expect(kPublicAddressWarning, 'This looks like a public address. The API is only reachable inside Tailscale.');
    });
  });

  group('the diagnostic lookup with an injected resolver (the request itself is unchanged)', () {
    test('tailnet address: shown, no warning, and the request still succeeds', () async {
      final t = StepTracker();
      expect(await _api((h) async => [_ip('100.101.2.3')]).health(tracker: t), isTrue);
      expect(t.resolvedSummary, 'resolved to 100.101.2.3');
      expect(t.addressNote, isNull);
      expect(t.elapsedOf(StepTracker.lookup), isNotNull);
      expect(t.elapsedOf(StepTracker.firstByte), isNotNull, reason: 'connect and first byte are separate steps');
    });

    test('public address: flagged in plain words', () async {
      final t = StepTracker();
      await _api((h) async => [_ip('154.160.1.1')]).health(tracker: t);
      expect(t.resolvedSummary, 'resolved to 154.160.1.1');
      expect(t.addressNote, kPublicAddressWarning);
    });

    test('private LAN address: shown, no warning', () async {
      final t = StepTracker();
      await _api((h) async => [_ip('192.168.1.7')]).health(tracker: t);
      expect(t.resolvedSummary, 'resolved to 192.168.1.7');
      expect(t.addressNote, isNull);
    });

    test('lookup failure: the error is shown, and the request goes on unchanged', () async {
      final t = StepTracker();
      expect(await _api((h) async => throw const SocketException('Failed host lookup')).health(tracker: t), isTrue);
      expect(t.resolvedSummary, 'name lookup failed: Failed host lookup');
      expect(t.addressNote, isNull);
    });

    test('lookup timeout: capped at 5 seconds (real time), recorded, and the request goes on', () async {
      expect(PreviewApi.lookupCap, const Duration(seconds: 5));
      final t = StepTracker();
      final never = Completer<List<InternetAddress>>();
      expect(await _api((h) => never.future).health(tracker: t), isTrue);
      expect(t.resolvedSummary, 'name lookup failed: no answer within 5 seconds');
      expect(t.elapsedOf(StepTracker.lookup)!.inMilliseconds, greaterThanOrEqualTo(4900));
    }, timeout: const Timeout(Duration(seconds: 20)));

    test('three addresses: only the first three are listed', () async {
      final t = StepTracker();
      await _api((h) async => [_ip('100.64.0.1'), _ip('100.64.0.2'), _ip('100.64.0.3'), _ip('100.64.0.4')]).health(tracker: t);
      expect(t.resolvedSummary, 'resolved to 100.64.0.1, 100.64.0.2, 100.64.0.3 (+1 more)');
    });
  });

  group('request screen', () {
    setUp(() => SharedPreferences.setMockInitialValues({}));

    Future<void> run(WidgetTester tester, Future<List<InternetAddress>> Function(String) resolver) async {
      final settings = await tester.runAsync(SettingsStore.open);
      await tester.pumpWidget(MaterialApp(
        home: RequestScreen(
          settings: settings!,
          apiFactory: (url) => PreviewApi(url, resolver: resolver, client: MockClient((r) async => throw const SocketException('connection timed out'))),
          sceneForManifest: (m, l) async => throw UnimplementedError(),
          bundledScene: () async => throw UnimplementedError(),
        ),
      ));
      await tester.tap(find.text('Test connection'));
      await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 300)));
      await tester.pump();
    }

    testWidgets('a public address shows "resolved to" and the warning', (tester) async {
      await run(tester, (h) async => [_ip('154.160.1.1')]);
      expect(find.byKey(const Key('resolved-address')), findsOneWidget);
      expect(find.text('resolved to 154.160.1.1'), findsOneWidget);
      expect(find.text(kPublicAddressWarning), findsOneWidget);
    });

    testWidgets('a tailnet address shows "resolved to" without the warning', (tester) async {
      await run(tester, (h) async => [_ip('100.101.2.3')]);
      expect(find.text('resolved to 100.101.2.3'), findsOneWidget);
      expect(find.byKey(const Key('address-warning')), findsNothing);
    });

    testWidgets('a failed lookup shows the error', (tester) async {
      await run(tester, (h) async => throw const SocketException('Failed host lookup'));
      expect(find.text('name lookup failed: Failed host lookup'), findsOneWidget);
    });
  });
}
