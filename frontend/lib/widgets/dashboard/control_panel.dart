import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../../core/theme.dart';
import '../../providers/dashboard_provider.dart';

class ControlPanel extends StatelessWidget {
  const ControlPanel({super.key});

  static const double _maxLinear = 0.5;
  static const double _maxAngular = 0.8;

  @override
  Widget build(BuildContext context) {
    return Consumer<DashboardState>(
      builder: (context, state, _) {
        if (!state.isConnected) return const SizedBox.shrink();

        return Positioned(
          right: 16,
          top: 16,
          child: Column(
            children: [
              _EmergencyStopButton(state: state),
              const SizedBox(height: 12),
              _JoystickPanel(
                onMove: (lx, az) => state.sendVelocity(linear: lx, angular: az),
                onStop: state.stopMotion,
              ),
            ],
          ),
        );
      },
    );
  }
}

class _EmergencyStopButton extends StatefulWidget {
  const _EmergencyStopButton({required this.state});

  final DashboardState state;

  @override
  State<_EmergencyStopButton> createState() => _EmergencyStopButtonState();
}

class _EmergencyStopButtonState extends State<_EmergencyStopButton> {
  bool _active = false;
  bool _loading = false;

  Future<void> _toggle() async {
    setState(() => _loading = true);
    try {
      final next = !_active;
      await widget.state.emergencyStop(activate: next);
      widget.state.stopMotion();
      setState(() => _active = next);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$e')));
      }
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Material(
      color: Colors.transparent,
      child: InkWell(
        onTap: _loading ? null : _toggle,
        borderRadius: BorderRadius.circular(12),
        child: AnimatedContainer(
          duration: const Duration(milliseconds: 200),
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
          decoration: BoxDecoration(
            color: _active ? AppTheme.danger : AppTheme.surface.withValues(alpha: 0.95),
            borderRadius: BorderRadius.circular(12),
            border: Border.all(
              color: _active ? AppTheme.danger : AppTheme.border,
              width: _active ? 2 : 1,
            ),
            boxShadow: [
              BoxShadow(
                color: (_active ? AppTheme.danger : Colors.black).withValues(alpha: _active ? 0.25 : 0.06),
                blurRadius: _active ? 12 : 8,
                offset: const Offset(0, 4),
              ),
            ],
          ),
          child: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              if (_loading)
                const SizedBox(
                  width: 16,
                  height: 16,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                )
              else
                Icon(
                  Icons.stop_circle_outlined,
                  color: _active ? Colors.white : AppTheme.danger,
                  size: 20,
                ),
              const SizedBox(width: 8),
              Text(
                _active ? 'E-STOP ON' : 'E-STOP',
                style: TextStyle(
                  fontWeight: FontWeight.w700,
                  fontSize: 12,
                  letterSpacing: 0.5,
                  color: _active ? Colors.white : AppTheme.textPrimary,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _JoystickPanel extends StatelessWidget {
  const _JoystickPanel({required this.onMove, required this.onStop});

  final void Function(double linear, double angular) onMove;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: BoxDecoration(
        color: AppTheme.surface.withValues(alpha: 0.95),
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: AppTheme.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.06),
            blurRadius: 12,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          children: [
            Text(
              'Manual Control',
              style: Theme.of(context).textTheme.labelSmall?.copyWith(color: AppTheme.textSecondary),
            ),
            const SizedBox(height: 10),
            _DirectionPad(onMove: onMove, onStop: onStop),
          ],
        ),
      ),
    );
  }
}

class _DirectionPad extends StatelessWidget {
  const _DirectionPad({required this.onMove, required this.onStop});

  final void Function(double linear, double angular) onMove;
  final VoidCallback onStop;

  @override
  Widget build(BuildContext context) {
    Widget btn(IconData icon, VoidCallback onTap, {VoidCallback? onRelease}) {
      return _HoldButton(
        icon: icon,
        onPressed: onTap,
        onReleased: onRelease ?? onStop,
      );
    }

    return Column(
      children: [
        btn(Icons.keyboard_arrow_up, () => onMove(ControlPanel._maxLinear, 0)),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            btn(Icons.rotate_left, () => onMove(0, ControlPanel._maxAngular)),
            const SizedBox(width: 4),
            _HoldButton(icon: Icons.stop, onPressed: onStop, onReleased: onStop, isStop: true),
            const SizedBox(width: 4),
            btn(Icons.rotate_right, () => onMove(0, -ControlPanel._maxAngular)),
          ],
        ),
        btn(Icons.keyboard_arrow_down, () => onMove(-ControlPanel._maxLinear, 0)),
      ],
    );
  }
}

class _HoldButton extends StatelessWidget {
  const _HoldButton({
    required this.icon,
    required this.onPressed,
    required this.onReleased,
    this.isStop = false,
  });

  final IconData icon;
  final VoidCallback onPressed;
  final VoidCallback onReleased;
  final bool isStop;

  @override
  Widget build(BuildContext context) {
    return Listener(
      onPointerDown: (_) => onPressed(),
      onPointerUp: (_) => onReleased(),
      onPointerCancel: (_) => onReleased(),
      child: Material(
        color: isStop ? AppTheme.surfaceElevated : AppTheme.surface,
        borderRadius: BorderRadius.circular(8),
        child: SizedBox(
          width: 40,
          height: 40,
          child: Icon(icon, size: 20, color: isStop ? AppTheme.textPrimary : AppTheme.accent),
        ),
      ),
    );
  }
}
