import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import '../core/theme.dart';
import '../models/occupancy_grid.dart';
import '../models/path_message.dart';
import '../models/robot_pose.dart';
import '../providers/dashboard_provider.dart';
import '../widgets/dashboard/control_panel.dart';
import '../widgets/dashboard/sidebar_panel.dart';
import '../widgets/map/occupancy_map_view.dart';

class DashboardScreen extends StatefulWidget {
  const DashboardScreen({super.key});

  @override
  State<DashboardScreen> createState() => _DashboardScreenState();
}

class _DashboardScreenState extends State<DashboardScreen> {
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!mounted) return;
      context.read<DashboardState>().connect();
    });
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: Consumer<DashboardState>(
        builder: (context, state, _) {
          OccupancyGrid? grid;
          if (state.mapData is Map<String, dynamic>) {
            grid = OccupancyGrid.fromJson(state.mapData as Map<String, dynamic>);
          }

          RobotPose? pose;
          if (state.amclPoseData is Map<String, dynamic>) {
            final candidate =
                RobotPose.fromAmclPose(state.amclPoseData as Map<String, dynamic>);
            if (candidate.isInMapFrame) pose = candidate;
          }
          if (pose == null && state.tfData is Map<String, dynamic>) {
            pose = RobotPose.fromTf(state.tfData as Map<String, dynamic>);
          }

          PathMessage? path;
          if (state.pathData is Map<String, dynamic>) {
            path = PathMessage.fromJson(state.pathData as Map<String, dynamic>);
          }

          return Row(
            children: [
              const SidebarPanel(),
              Expanded(
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.stretch,
                    children: [
                      _TopBar(isConnected: state.isConnected, status: state.robotStatus),
                      const SizedBox(height: 12),
                      Expanded(
                        child: Stack(
                          children: [
                            OccupancyMapView(
                              grid: grid,
                              pose: pose,
                              path: path,
                            ),
                            const ControlPanel(),
                          ],
                        ),
                      ),
                    ],
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }
}

class _TopBar extends StatelessWidget {
  const _TopBar({required this.isConnected, required this.status});

  final bool isConnected;
  final String status;

  @override
  Widget build(BuildContext context) {
    return Row(
      children: [
        Text(
          'Map View',
          style: Theme.of(context).textTheme.titleLarge?.copyWith(fontWeight: FontWeight.w600),
        ),
        const Spacer(),
        _Chip(
          icon: Icons.sensors,
          label: isConnected ? 'Live' : 'Offline',
          color: isConnected ? AppTheme.success : AppTheme.textSecondary,
        ),
        const SizedBox(width: 8),
        _Chip(
          icon: Icons.memory,
          label: status,
          color: AppTheme.accent,
        ),
      ],
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.icon, required this.label, required this.color});

  final IconData icon;
  final String label;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
      decoration: BoxDecoration(
        color: AppTheme.surface,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: AppTheme.border),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withValues(alpha: 0.04),
            blurRadius: 8,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(icon, size: 14, color: color),
          const SizedBox(width: 6),
          Text(
            label,
            style: TextStyle(fontSize: 12, color: color, fontWeight: FontWeight.w500),
          ),
        ],
      ),
    );
  }
}
