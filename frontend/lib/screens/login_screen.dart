import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/config.dart';
import '../core/theme.dart';
import '../providers/dashboard_provider.dart';
import 'dashboard_screen.dart';

class LoginScreen extends StatefulWidget {
  const LoginScreen({super.key});

  @override
  State<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends State<LoginScreen> {
  final _formKey = GlobalKey<FormState>();
  final _usernameController = TextEditingController();
  final _passwordController = TextEditingController();
  final _baseUrlController = TextEditingController(text: AppConfig.defaultBaseUrl);
  bool _loading = false;
  bool _obscurePassword = true;

  @override
  void dispose() {
    _usernameController.dispose();
    _passwordController.dispose();
    _baseUrlController.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (!_formKey.currentState!.validate()) return;

    setState(() => _loading = true);
    final state = context.read<DashboardState>();
    state.updateSettings(baseUrl: _baseUrlController.text.trim());

    final ok = await state.login(
      _usernameController.text.trim(),
      _passwordController.text,
    );

    if (!mounted) return;
    setState(() => _loading = false);

    if (ok) {
      Navigator.of(context).pushReplacement(
        MaterialPageRoute(builder: (_) => const DashboardScreen()),
      );
    }
  }

  Future<void> _skipLogin() async {
    final state = context.read<DashboardState>();
    state.updateSettings(baseUrl: _baseUrlController.text.trim());
    state.skipAuth();
    Navigator.of(context).pushReplacement(
      MaterialPageRoute(builder: (_) => const DashboardScreen()),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Center(
        child: SingleChildScrollView(
          padding: const EdgeInsets.all(24),
          child: ConstrainedBox(
            constraints: const BoxConstraints(maxWidth: 400),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                _BrandHeader(),
                const SizedBox(height: 40),
                Card(
                  child: Padding(
                    padding: const EdgeInsets.all(28),
                    child: Form(
                      key: _formKey,
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.stretch,
                        children: [
                          Text(
                            'Sign in',
                            style: Theme.of(context).textTheme.headlineSmall?.copyWith(
                                  fontWeight: FontWeight.w600,
                                ),
                          ),
                          const SizedBox(height: 6),
                          Text(
                            'Connect to your AMR fleet backend',
                            style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                                  color: AppTheme.textSecondary,
                                ),
                          ),
                          const SizedBox(height: 28),
                          TextFormField(
                            controller: _baseUrlController,
                            decoration: const InputDecoration(
                              labelText: 'Backend URL',
                              prefixIcon: Icon(Icons.dns_outlined, size: 20),
                            ),
                          ),
                          const SizedBox(height: 16),
                          TextFormField(
                            controller: _usernameController,
                            decoration: const InputDecoration(
                              labelText: 'Username',
                              prefixIcon: Icon(Icons.person_outline, size: 20),
                            ),
                            validator: (v) =>
                                (v == null || v.isEmpty) ? 'Username required' : null,
                          ),
                          const SizedBox(height: 16),
                          TextFormField(
                            controller: _passwordController,
                            obscureText: _obscurePassword,
                            decoration: InputDecoration(
                              labelText: 'Password',
                              prefixIcon: const Icon(Icons.lock_outline, size: 20),
                              suffixIcon: IconButton(
                                icon: Icon(
                                  _obscurePassword ? Icons.visibility_off : Icons.visibility,
                                  size: 20,
                                ),
                                onPressed: () =>
                                    setState(() => _obscurePassword = !_obscurePassword),
                              ),
                            ),
                            validator: (v) =>
                                (v == null || v.isEmpty) ? 'Password required' : null,
                            onFieldSubmitted: (_) => _submit(),
                          ),
                          const SizedBox(height: 8),
                          Consumer<DashboardState>(
                            builder: (context, state, _) {
                              if (state.errorMessage == null) return const SizedBox.shrink();
                              return Padding(
                                padding: const EdgeInsets.only(top: 8),
                                child: Text(
                                  state.errorMessage!,
                                  style: const TextStyle(color: AppTheme.danger, fontSize: 13),
                                ),
                              );
                            },
                          ),
                          const SizedBox(height: 24),
                          ElevatedButton(
                            onPressed: _loading ? null : _submit,
                            child: _loading
                                ? const SizedBox(
                                    width: 22,
                                    height: 22,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Text('Sign in'),
                          ),
                          const SizedBox(height: 12),
                          TextButton(
                            onPressed: _loading ? null : _skipLogin,
                            child: const Text(
                              'Continue without login',
                              style: TextStyle(color: AppTheme.textSecondary),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Column(
      children: [
        Container(
          width: 56,
          height: 56,
          decoration: BoxDecoration(
            gradient: const LinearGradient(
              colors: [AppTheme.accent, Color(0xFF2563EB)],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(16),
          ),
          child: const Icon(Icons.map_outlined, color: Colors.white, size: 28),
        ),
        const SizedBox(height: 16),
        Text(
          'Fasta AMR',
          style: Theme.of(context).textTheme.headlineMedium?.copyWith(
                fontWeight: FontWeight.w700,
                letterSpacing: -0.5,
              ),
        ),
        const SizedBox(height: 4),
        Text(
          'Robot visualization dashboard',
          style: Theme.of(context).textTheme.bodyMedium?.copyWith(
                color: AppTheme.textSecondary,
              ),
        ),
      ],
    );
  }
}
