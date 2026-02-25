@app.post("/robots/{robot_id}/publish/twist")
async def publish_twist(robot_id: str = Path(..., description="Unique ID of the robot"),
                        req: TwistMessageRequest = None,):
    
    try: 
        robot = get_robot(robot_id)
        robot.publish_twist(req.linear,req.angular)
        return {"status": "published", "robot_id": robot_id, "message": req}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.post("/robots/{robot_id}/publish/pose")
async def publish_pose(robot_id: str = Path(..., description="Unique ID of the robot"),
                       req: PoseMessageRequest=None):
    
    try: 
        robot = get_robot(robot_id)
        robot.publish_pose(req.position,req.orientation)
        return {"status": "published", "robot_id": robot_id, "message": req}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    
 
@app.post("/robots/{robot_id}/publish/goal_pose")
async def publish_goal_pose(robot_id: str = Path(..., description="Unique ID of the robot"),
                            req: GoalPoseMessageRequest = None):
    try:
        pose_msg ={
            "header": {
                "frame_id": req.header.frame_id,
                "stamp": req.header.stamp
            },
            "pose": {
                "position": {
                    "x": req.pose.position.x,
                    "y": req.pose.position.y,
                    "z": req.pose.position.z
                },
                "orientation": {
                    "x": req.pose.orientation.x,
                    "y": req.pose.orientation.y,
                    "z": req.pose.orientation.z,
                    "w": req.pose.orientation.w
                }
            }
        }

        robot = get_robot(robot_id)
        robot.publish_goal_pose(pose_msg.header,pose_msg.pose)
        return {"status": "published", "robot_id": robot_id, "message": req}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Subscribers API 
@app.post("/robots/{robot_id}/subscribe/odom")
async def get_odom(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        message = robot.subscribe_odom()
        return {"status": "published", "robot_id": robot_id, "message": message}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/robots/{robot_id}/subscribe/tf")
async def get_tf(robot_id: str = Path(..., description="Unique ID of the robot")):
    try: 
        robot = get_robot(robot_id)
        message = robot.subscribe_tf()
        return {"status": "published", "robot_id": robot_id, "message": message}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
  