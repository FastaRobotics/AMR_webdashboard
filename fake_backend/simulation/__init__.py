"""Simulation package: everything that stands in for "the robot side".

The modules here have no FastAPI dependency. They model the environment, the
robots' motion, the ROS topics and the ROS services, and are driven by
``engine.SimulationEngine`` at a fixed rate.
"""
