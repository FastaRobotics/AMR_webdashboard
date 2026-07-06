import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../providers/dashboard_provider.dart';

class SidebarPanel extends StatelessWidget {
  const SidebarPanel({super.key});

  @override
  Widget build(BuildContext context) {
    return Consumer<DashboardState>(
      builder: (context, state, _) {
        return Container(
          width: 300,
          decoration: const BoxDecoration(
            color: AppTheme.surface,
            border: Border(right: BorderSide(color: AppTheme.border)),
          ),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _Header(robotId: state.robotId),
              Expanded(
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    _StatusCard(
                      isConnected: state.isConnected,
                      isConnecting: state.isConnecting,
                      errorMessage: state.errorMessage,
                      status: state.robotStatus,
                      linearVel: state.linearVelocity,
                      angularVel: state.angularVelocity,
                    ),
                    const SizedBox(height: 16),
                    _ConnectionCard(state: state),
                    const SizedBox(height: 16),
                    _NavigationCard(state: state),
                  ],
                ),
              ),
              _Footer(onLogout: state.logout),
            ],
          ),
        );
      },
    );
  }
}

class _Header extends StatelessWidget {
  const _Header({required this.robotId});

  final String robotId;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 24, 20, 20),
      decoration: const BoxDecoration(
        border: Border(bottom: BorderSide(color: AppTheme.border)),
      ),
      child: Row(
        children: [
          Container(
            width: 36,
            height: 36,
            decoration: BoxDecoration(
              color: AppTheme.accentMuted,
              borderRadius: BorderRadius.circular(10),
            ),
            child: const Icon(Icons.smart_toy_outlined, color: AppTheme.accent, size: 20),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  'AMR Dashboard',
                  style: Theme.of(context).textTheme.titleMedium?.copyWith(
                        fontWeight: FontWeight.w600,
                      ),
                ),
                Text(
                  robotId.toUpperCase(),
                  style: Theme.of(context).textTheme.bodySmall?.copyWith(
                        color: AppTheme.textSecondary,
                      ),
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _StatusCard extends StatelessWidget {
  const _StatusCard({
    required this.isConnected,
    required this.isConnecting,
    required this.errorMessage,
    required this.status,
    required this.linearVel,
    required this.angularVel,
  });

  final bool isConnected;
  final bool isConnecting;
  final String? errorMessage;
  final String status;
  final double linearVel;
  final double angularVel;

  @override
  Widget build(BuildContext context) {
    final statusColor = isConnecting
        ? AppTheme.warning
        : !isConnected
            ? AppTheme.textSecondary
            : status == 'run_task'
                ? AppTheme.warning
                : AppTheme.success;

    final statusLabel = isConnecting
        ? 'connecting…'
        : isConnected
            ? status
            : 'disconnected';

    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              'Robot Status',
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: AppTheme.textSecondary,
                  ),
            ),
            const SizedBox(height: 12),
            Row(
              children: [
                if (isConnecting)
                  const SizedBox(
                    width: 14,
                    height: 14,
                    child: CircularProgressIndicator(strokeWidth: 2),
                  )
                else
                  Container(
                    width: 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: statusColor,
                      shape: BoxShape.circle,
                      boxShadow: isConnected
                          ? [BoxShadow(color: statusColor.withValues(alpha: 0.5), blurRadius: 6)]
                          : null,
                    ),
                  ),
                const SizedBox(width: 8),
                Text(
                  statusLabel,
                  style: const TextStyle(fontWeight: FontWeight.w500),
                ),
              ],
            ),
            if (errorMessage != null && !isConnected) ...[
              const SizedBox(height: 8),
              Text(
                errorMessage!,
                style: const TextStyle(color: AppTheme.danger, fontSize: 12),
              ),
            ],
            if (isConnected) ...[
              const SizedBox(height: 12),
              _MetricRow(label: 'Linear', value: '${linearVel.toStringAsFixed(2)} m/s'),
              const SizedBox(height: 4),
              _MetricRow(label: 'Angular', value: '${angularVel.toStringAsFixed(2)} rad/s'),
            ],
          ],
        ),
      ),
    );
  }
}

class _MetricRow extends StatelessWidget {
  const _MetricRow({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisAlignment: MainAxisAlignment.spaceBetween,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 12)),
        Text(value, style: const TextStyle(fontSize: 12, fontFeatures: [])),
      ],
    );
  }
}

class _ConnectionCard extends StatelessWidget {
  const _ConnectionCard({required this.state});

  final DashboardState state;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Connection',
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: AppTheme.textSecondary,
                  ),
            ),
            const SizedBox(height: 12),
            _LabeledField(
              label: 'ROS Host',
              child: Text(
                state.rosHost,
                style: const TextStyle(fontSize: 13),
              ),
            ),
            const SizedBox(height: 10),
            _LabeledField(
              label: 'ROS Port',
              child: Text(
                state.rosPort.toString(),
                style: const TextStyle(fontSize: 13),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _NavigationCard extends StatelessWidget {
  const _NavigationCard({required this.state});

  final DashboardState state;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Navigation',
              style: Theme.of(context).textTheme.labelLarge?.copyWith(
                    color: AppTheme.textSecondary,
                  ),
            ),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: state.isConnected
                  ? () async {
                      try {
                        await state.startNavigation();
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Navigation started')),
                          );
                        }
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            SnackBar(content: Text('$e')),
                          );
                        }
                      }
                    }
                  : null,
              child: const Text('Start Navigation'),
            ),
            const SizedBox(height: 8),
            OutlinedButton(
              onPressed: state.isConnected ? () => state.stopNavigation() : null,
              child: const Text('Stop Navigation'),
            ),
          ],
        ),
      ),
    );
  }
}

class _LabeledField extends StatelessWidget {
  const _LabeledField({required this.label, required this.child});

  final String label;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(label, style: const TextStyle(color: AppTheme.textSecondary, fontSize: 11)),
        const SizedBox(height: 6),
        child,
      ],
    );
  }
}

class _Footer extends StatelessWidget {
  const _Footer({required this.onLogout});

  final VoidCallback onLogout;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: const BoxDecoration(
        border: Border(top: BorderSide(color: AppTheme.border)),
      ),
      child: OutlinedButton.icon(
        onPressed: onLogout,
        icon: const Icon(Icons.logout, size: 18),
        label: const Text('Sign out'),
      ),
    );
  }
}
