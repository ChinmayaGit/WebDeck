import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:webdeck/data/repositories/app_repository.dart';
import 'package:webdeck/data/services/storage_service.dart';
import 'package:webdeck/ui/core/theme.dart';
import 'package:webdeck/ui/features/catalog/view_models/catalog_view_model.dart';
import 'package:webdeck/ui/features/catalog/views/install_dialog.dart';

class _HoldInstallViewModel extends CatalogViewModel {
  _HoldInstallViewModel(super.repository);

  int installCalls = 0;

  @override
  Future<bool> installFromSource({
    required String sourceUrl,
    String? token,
    String? customName,
  }) async {
    installCalls++;
    await Future<void>.delayed(const Duration(milliseconds: 300));
    return false;
  }
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();

  late Directory tempDir;
  late _HoldInstallViewModel viewModel;

  setUp(() async {
    tempDir = await Directory.systemTemp.createTemp('webdeck_install_dialog_');
    viewModel = _HoldInstallViewModel(
      AppRepository(storageService: StorageService(customBaseDir: tempDir)),
    );
  });

  tearDown(() async {
    if (await tempDir.exists()) {
      await tempDir.delete(recursive: true);
    }
  });

  testWidgets('phone install button is full width and shows loading once', (
    tester,
  ) async {
    await tester.binding.setSurfaceSize(const Size(390, 844));
    addTearDown(() => tester.binding.setSurfaceSize(null));

    await tester.pumpWidget(
      MaterialApp(
        theme: WebDeckTheme.darkTheme,
        home: Scaffold(
          body: Builder(
            builder: (context) {
              return TextButton(
                onPressed: () {
                  showDialog<void>(
                    context: context,
                    builder: (_) => InstallAppDialog(viewModel: viewModel),
                  );
                },
                child: const Text('open'),
              );
            },
          ),
        ),
      ),
    );

    await tester.tap(find.text('open'));
    await tester.pumpAndSettle();

    final idleButton = find.widgetWithText(ElevatedButton, 'Fetch & Install');
    expect(idleButton, findsOneWidget);
    final idleRect = tester.getRect(idleButton);
    expect(idleRect.left, lessThan(48));
    expect(idleRect.width, greaterThan(280));
    expect(idleRect.right, lessThan(390 - 12));

    await tester.enterText(
      find.byType(TextField).first,
      'ChinmayaGit/EMPManagement',
    );
    await tester.tap(idleButton);
    await tester.pump();

    final loadingButton = find.widgetWithText(ElevatedButton, 'Installing…');
    expect(loadingButton, findsOneWidget);
    expect(find.text('Downloading & installing…'), findsOneWidget);
    expect(find.byType(CircularProgressIndicator), findsNothing);
    expect(find.byType(LinearProgressIndicator), findsOneWidget);
    expect(viewModel.installCalls, 1);

    final loadingRect = tester.getRect(loadingButton);
    expect(loadingRect.width, greaterThan(280));

    await tester.tap(loadingButton);
    await tester.pump(const Duration(milliseconds: 50));
    expect(viewModel.installCalls, 1);

    await tester.pump(const Duration(milliseconds: 300));
    expect(find.widgetWithText(ElevatedButton, 'Fetch & Install'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });
}
