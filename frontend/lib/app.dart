import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'core/theme.dart';
import 'providers/dashboard_provider.dart';
import 'screens/login_screen.dart';

class AmrDashboardApp extends StatelessWidget {
  const AmrDashboardApp({super.key});

  @override
  Widget build(BuildContext context) {
    return ChangeNotifierProvider(
      create: (_) => DashboardState(),
      child: MaterialApp(
        title: 'Fasta AMR Dashboard',
        debugShowCheckedModeBanner: false,
        theme: AppTheme.light(),
        home: const LoginScreen(),
      ),
    );
  }
}
