import 'dart:async';

import 'package:flutter/material.dart';
import 'package:provider/provider.dart';
import 'package:supabase_flutter/supabase_flutter.dart' show AuthException;

import '../../../runtime/cloud_service.dart';
import '../../core/theme.dart';
import '../shell/shell_screen.dart';

/// Shows the login page unless the device is signed in with a real account.
/// Anonymous users see it on every launch (with "Continue anonymously").
class AuthGate extends StatefulWidget {
  const AuthGate({super.key});

  @override
  State<AuthGate> createState() => _AuthGateState();
}

class _AuthGateState extends State<AuthGate> {
  bool _checking = true;
  bool _passed = false;

  @override
  void initState() {
    super.initState();
    final cloud = context.read<CloudService>();
    // Restore the saved session; never block the app for long if offline.
    cloud.init().timeout(const Duration(seconds: 4)).catchError((_) {}).whenComplete(() {
      if (!mounted) return;
      setState(() {
        _checking = false;
        _passed = cloud.hasAccount;
      });
      if (cloud.hasAccount) unawaited(cloud.start());
    });
  }

  @override
  Widget build(BuildContext context) {
    if (_checking) {
      return const Scaffold(
        backgroundColor: WebDeckTheme.background,
        body: Center(child: CircularProgressIndicator()),
      );
    }
    if (_passed) return const ShellScreen();
    return AuthScreen(onDone: () => setState(() => _passed = true));
  }
}

/// Sign in / create account, with "Continue anonymously" below.
/// Also opened from Settings (then [allowAnonymous] is false and it pops when done).
class AuthScreen extends StatefulWidget {
  final VoidCallback? onDone;
  final bool allowAnonymous;
  const AuthScreen({super.key, this.onDone, this.allowAnonymous = true});

  @override
  State<AuthScreen> createState() => _AuthScreenState();
}

class _AuthScreenState extends State<AuthScreen> {
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _create = false;
  bool _busy = false;
  bool _showPassword = false;
  String? _error;
  String? _info;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  void _finish() {
    if (widget.onDone != null) {
      widget.onDone!();
    } else if (mounted) {
      Navigator.of(context).pop(true);
    }
  }

  String? _validate() {
    final email = _email.text.trim();
    if (!RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$').hasMatch(email)) return 'Enter a valid email address';
    if (_password.text.length < 6) return 'Password must be at least 6 characters';
    return null;
  }

  Future<void> _submit() async {
    final problem = _validate();
    if (problem != null) {
      setState(() => _error = problem);
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
      _info = null;
    });
    final cloud = context.read<CloudService>();
    try {
      if (_create) {
        final ready = await cloud.signUp(_email.text, _password.text);
        if (ready) {
          _finish();
        } else {
          setState(() {
            _info = 'Check ${_email.text.trim()} for a confirmation link, then sign in here.';
            _create = false;
          });
        }
      } else {
        await cloud.signIn(_email.text, _password.text);
        _finish();
      }
    } on AuthException catch (e) {
      setState(() => _error = _friendly(e.message));
    } catch (e) {
      setState(() => _error = 'Could not reach WebDeck Cloud. Check your connection or continue anonymously.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _friendly(String msg) {
    final m = msg.toLowerCase();
    if (m.contains('invalid login')) return 'Wrong email or password.';
    if (m.contains('not confirmed')) return 'Confirm your email first (check your inbox), then sign in.';
    if (m.contains('already') && m.contains('registered')) return 'That email already has an account. Sign in instead.';
    if (m.contains('email rate limit') || m.contains('error sending') || m.contains('sending confirmation')) {
      return "WebDeck couldn't send the confirmation email (its email limit is reached). "
          'Try again later, or continue anonymously for now.';
    }
    if (m.contains('rate limit') || m.contains('too many')) return 'Too many attempts. Wait a minute and try again.';
    return msg;
  }

  Future<void> _forgot() async {
    final email = _email.text.trim();
    if (!email.contains('@')) {
      setState(() => _error = 'Enter your email above, then tap "Forgot password?"');
      return;
    }
    setState(() => _busy = true);
    try {
      await context.read<CloudService>().resetPassword(email);
      setState(() => _info = 'If $email has an account, a reset link is on its way.');
    } catch (e) {
      setState(() => _error = 'Could not send the reset email: $e');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  Future<void> _anonymous() async {
    setState(() {
      _busy = true;
      _error = null;
    });
    final cloud = context.read<CloudService>();
    // Reuse the device's anonymous account (keeps its number). Offline still works.
    unawaited(cloud.start());
    if (mounted) setState(() => _busy = false);
    _finish();
  }

  @override
  Widget build(BuildContext context) {
    final standalone = widget.onDone == null;
    return Scaffold(
      backgroundColor: WebDeckTheme.background,
      appBar: standalone ? AppBar(title: const Text('Account')) : null,
      body: SafeArea(
        child: Center(
          child: SingleChildScrollView(
            padding: const EdgeInsets.all(24),
            child: ConstrainedBox(
              constraints: const BoxConstraints(maxWidth: 400),
              child: AutofillGroup(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    Center(
                      child: ClipRRect(
                        borderRadius: BorderRadius.circular(18),
                        child: Image.asset('assets/icons/app_icon.png', width: 72, height: 72,
                            errorBuilder: (_, _, _) => const Icon(Icons.rocket_launch, size: 56, color: WebDeckTheme.primary)),
                      ),
                    ),
                    const SizedBox(height: 18),
                    Text(
                      _create ? 'Create your WebDeck account' : 'Sign in to WebDeck',
                      textAlign: TextAlign.center,
                      style: const TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
                    ),
                    const SizedBox(height: 6),
                    const Text(
                      'Keep your caller number, submissions and settings across devices.',
                      textAlign: TextAlign.center,
                      style: TextStyle(color: WebDeckTheme.textSecondary),
                    ),
                    const SizedBox(height: 24),
                    SegmentedButton<bool>(
                      segments: const [
                        ButtonSegment(value: false, label: Text('Sign in')),
                        ButtonSegment(value: true, label: Text('Create account')),
                      ],
                      selected: {_create},
                      showSelectedIcon: false,
                      onSelectionChanged: _busy ? null : (v) => setState(() {
                        _create = v.first;
                        _error = null;
                      }),
                    ),
                    const SizedBox(height: 16),
                    TextField(
                      controller: _email,
                      enabled: !_busy,
                      keyboardType: TextInputType.emailAddress,
                      autofillHints: const [AutofillHints.email],
                      textInputAction: TextInputAction.next,
                      decoration: const InputDecoration(labelText: 'Email', prefixIcon: Icon(Icons.mail_outline)),
                    ),
                    const SizedBox(height: 12),
                    TextField(
                      controller: _password,
                      enabled: !_busy,
                      obscureText: !_showPassword,
                      autofillHints: [_create ? AutofillHints.newPassword : AutofillHints.password],
                      textInputAction: TextInputAction.done,
                      onSubmitted: (_) => _busy ? null : _submit(),
                      decoration: InputDecoration(
                        labelText: 'Password',
                        prefixIcon: const Icon(Icons.lock_outline),
                        suffixIcon: IconButton(
                          tooltip: _showPassword ? 'Hide password' : 'Show password',
                          icon: Icon(_showPassword ? Icons.visibility_off : Icons.visibility),
                          onPressed: () => setState(() => _showPassword = !_showPassword),
                        ),
                      ),
                    ),
                    if (!_create)
                      Align(
                        alignment: Alignment.centerRight,
                        child: TextButton(onPressed: _busy ? null : _forgot, child: const Text('Forgot password?')),
                      )
                    else
                      const SizedBox(height: 12),
                    if (_error != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Text(_error!, style: const TextStyle(color: WebDeckTheme.accentRed)),
                      ),
                    if (_info != null)
                      Padding(
                        padding: const EdgeInsets.only(bottom: 10),
                        child: Text(_info!, style: const TextStyle(color: WebDeckTheme.accentGreen)),
                      ),
                    FilledButton(
                      onPressed: _busy ? null : _submit,
                      style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(48)),
                      child: _busy
                          ? const SizedBox(width: 20, height: 20, child: CircularProgressIndicator(strokeWidth: 2))
                          : Text(_create ? 'Create account' : 'Sign in'),
                    ),
                    if (widget.allowAnonymous) ...[
                      const SizedBox(height: 22),
                      const Row(
                        children: [
                          Expanded(child: Divider(color: WebDeckTheme.border)),
                          Padding(
                            padding: EdgeInsets.symmetric(horizontal: 10),
                            child: Text('or', style: TextStyle(color: WebDeckTheme.textSecondary)),
                          ),
                          Expanded(child: Divider(color: WebDeckTheme.border)),
                        ],
                      ),
                      const SizedBox(height: 14),
                      OutlinedButton.icon(
                        onPressed: _busy ? null : _anonymous,
                        style: OutlinedButton.styleFrom(minimumSize: const Size.fromHeight(46)),
                        icon: const Icon(Icons.person_outline),
                        label: const Text('Continue anonymously'),
                      ),
                      const SizedBox(height: 8),
                      const Text(
                        'Everything works, but your data stays on this device only. '
                        'You can create an account later in Settings and keep it.',
                        textAlign: TextAlign.center,
                        style: TextStyle(fontSize: 12, color: WebDeckTheme.textSecondary),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ),
        ),
      ),
    );
  }
}
