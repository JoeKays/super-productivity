import {TaskActions, TaskActionTypes} from './task.actions';
import {ShowSubTasksMode, TaskAdditionalInfoTargetPanel, TaskState} from '../task.model';
import {calcTotalTimeSpent} from '../util/calc-total-time-spent';
import {AddAttachment, AttachmentActionTypes, DeleteAttachment} from '../../attachment/store/attachment.actions';
import {AddTaskRepeatCfgToTask, TaskRepeatCfgActionTypes} from '../../task-repeat-cfg/store/task-repeat-cfg.actions';
import {
  deleteTask,
  filterOutId,
  getTaskById,
  reCalcTimesForParentIfParent,
  updateTimeEstimateForTask,
  updateTimeSpentForTask
} from './task.reducer.util';
import {taskAdapter} from './task.adapter';
import {moveItemInList} from '../../work-context/store/work-context-meta.helper';
import {arrayMoveLeft, arrayMoveRight} from '../../../util/array-move';

export const TASK_FEATURE_NAME = 'tasks';


// REDUCER
// -------
export const initialTaskState: TaskState = taskAdapter.getInitialState({
  // overwrite entity model to avoid problems with typing
  ids: [],

  currentTaskId: null,
  selectedTaskId: null,
  taskAdditionalInfoTargetPanel: TaskAdditionalInfoTargetPanel.Default,
  lastCurrentTaskId: null,
  stateBefore: null,
  isDataLoaded: false,
}) as TaskState;


// TODO unit test the shit out of this once the model is settled
export function taskReducer(
  state: TaskState = initialTaskState,
  action: TaskActions | AddAttachment | DeleteAttachment | AddTaskRepeatCfgToTask
): TaskState {

  switch (action.type) {
    // Meta Actions
    // ------------
    case AttachmentActionTypes.AddAttachment: {
      const {taskId, id} = action.payload.attachment;
      const task = state.entities[taskId];
      return {
        ...state,
        entities:
          {
            ...state.entities,
            [taskId]: {
              ...task,
              attachmentIds: task.attachmentIds ? [...task.attachmentIds, (id as string)] : [id as string],
            }
          },
      };
    }

    case AttachmentActionTypes.DeleteAttachment: {
      const attachmentId = action.payload.id;
      const taskIds = state.ids as string[];
      const affectedTaskId = taskIds.find(
        id => state.entities[id].attachmentIds && state.entities[id].attachmentIds.includes(attachmentId)
      );
      const affectedTask = state.entities[affectedTaskId];
      return {
        ...state,
        entities:
          {
            ...state.entities,
            [affectedTaskId]: {
              ...affectedTask,
              attachmentIds: affectedTask.attachmentIds ? affectedTask.attachmentIds.filter(idIN => idIN !== attachmentId) : [],
            }
          },
      };
    }

    case TaskActionTypes.LoadTaskState: {
      const newState = action.payload.state;
      return {
        ...newState,
        currentTaskId: null,
        lastCurrentTaskId: newState.currentTaskId,
        isDataLoaded: true,
      };
    }

    case TaskActionTypes.SetCurrentTask: {
      if (action.payload) {
        const subTaskIds = state.entities[action.payload].subTaskIds;
        let taskToStartId = action.payload;
        if (subTaskIds && subTaskIds.length) {
          const undoneTasks = subTaskIds.map(id => state.entities[id]).filter(task => !task.isDone);
          taskToStartId = undoneTasks.length ? undoneTasks[0].id : subTaskIds[0];
        }
        return {
          ...(taskAdapter.updateOne({
            id: taskToStartId,
            changes: {isDone: false}
          }, state)),
          currentTaskId: taskToStartId,
          selectedTaskId: state.selectedTaskId && taskToStartId,
        };
      } else {
        return {
          ...state,
          currentTaskId: action.payload,
        };
      }
    }

    case TaskActionTypes.UnsetCurrentTask: {
      return {...state, currentTaskId: null, lastCurrentTaskId: state.currentTaskId};
    }

    case TaskActionTypes.SetSelectedTask: {
      const {id, taskAdditionalInfoTargetPanel} = action.payload;
      return {
        ...state,
        taskAdditionalInfoTargetPanel: (id === state.selectedTaskId) ? null : taskAdditionalInfoTargetPanel,
        selectedTaskId: (id === state.selectedTaskId) ? null : id,
      };
    }

    // Task Actions
    // ------------
    case TaskActionTypes.AddTask: {
      const task = {
        ...action.payload.task,
        timeSpent: calcTotalTimeSpent(action.payload.task.timeSpentOnDay),
      };
      return taskAdapter.addOne(task, state);
    }

    case TaskActionTypes.UpdateTask: {
      let stateCopy = state;
      const id = action.payload.task.id as string;
      const {timeSpentOnDay, timeEstimate, isDone} = action.payload.task.changes;
      stateCopy = updateTimeSpentForTask(id, timeSpentOnDay, stateCopy);
      stateCopy = updateTimeEstimateForTask(id, timeEstimate, stateCopy);
      return taskAdapter.updateOne(action.payload.task, stateCopy);
    }

    case TaskActionTypes.UpdateTaskUi: {
      return taskAdapter.updateOne(action.payload.task, state);
    }

    case TaskActionTypes.UpdateTaskTags: {
      return taskAdapter.updateOne({
        id: action.payload.taskId,
        changes: {
          tagIds: action.payload.newTagIds,
        }
      }, state);
    }

    // TODO simplify
    case TaskActionTypes.ToggleTaskShowSubTasks: {
      const {taskId, isShowLess, isEndless} = action.payload;
      const task = state.entities[taskId];
      const subTasks = task.subTaskIds.map(id => state.entities[id]);
      const doneTasksLength = subTasks.filter(t => t.isDone).length;
      const isDoneTaskCaseNeeded = doneTasksLength && (doneTasksLength < subTasks.length);
      const oldVal = +task._showSubTasksMode;
      let newVal;

      if (isDoneTaskCaseNeeded) {
        newVal = oldVal + (isShowLess ? -1 : 1);
        if (isEndless) {
          if (newVal > ShowSubTasksMode.Show) {
            newVal = ShowSubTasksMode.HideAll;
          } else if (newVal < ShowSubTasksMode.HideAll) {
            newVal = ShowSubTasksMode.Show;
          }
        } else {
          if (newVal > ShowSubTasksMode.Show) {
            newVal = ShowSubTasksMode.Show;
          }
          if (newVal < ShowSubTasksMode.HideAll) {
            newVal = ShowSubTasksMode.HideAll;
          }
        }

      } else {
        if (isEndless) {
          if (oldVal === ShowSubTasksMode.Show) {
            newVal = ShowSubTasksMode.HideAll;
          }
          if (oldVal !== ShowSubTasksMode.Show) {
            newVal = ShowSubTasksMode.Show;
          }
        } else {
          newVal = (isShowLess)
            ? ShowSubTasksMode.HideAll
            : ShowSubTasksMode.Show;
        }
      }

      // failsafe
      newVal = (isNaN(newVal)) ? ShowSubTasksMode.HideAll : newVal;

      return taskAdapter.updateOne({
        id: taskId,
        changes: {
          _showSubTasksMode: newVal
        }
      }, state);
    }

    case TaskActionTypes.DeleteTask: {
      return deleteTask(state, action.payload.task);
    }

    case TaskActionTypes.UndoDeleteTask: {
      return state.stateBefore || state;
    }

    case TaskActionTypes.MoveSubTask: {
      let newState = state;
      const {taskId, srcTaskId, targetTaskId, newOrderedIds} = action.payload;
      const oldPar = state.entities[srcTaskId];
      const newPar = state.entities[targetTaskId];

      // for old parent remove
      newState = taskAdapter.updateOne({
        id: oldPar.id,
        changes: {
          subTaskIds: oldPar.subTaskIds.filter(filterOutId(taskId))
        }
      }, newState);
      newState = reCalcTimesForParentIfParent(oldPar.id, newState);

      // for new parent add and move
      newState = taskAdapter.updateOne({
        id: newPar.id,
        changes: {
          subTaskIds: moveItemInList(taskId, newPar.subTaskIds, newOrderedIds),
        }
      }, newState);
      newState = reCalcTimesForParentIfParent(newPar.id, newState);

      // change parent id for moving task
      newState = taskAdapter.updateOne({
        id: taskId,
        changes: {
          parentId: newPar.id
        }
      }, newState);


      return newState;
    }

    case TaskActionTypes.MoveSubTaskUp: {
      const {id, parentId} = action.payload;
      const parentSubTaskIds = state.entities[parentId].subTaskIds;
      return taskAdapter.updateOne({
        id: parentId,
        changes: {
          subTaskIds: arrayMoveLeft(parentSubTaskIds, id)
        }
      }, state);
    }

    case TaskActionTypes.MoveSubTaskDown: {
      const {id, parentId} = action.payload;
      const parentSubTaskIds = state.entities[parentId].subTaskIds;
      return taskAdapter.updateOne({
        id: parentId,
        changes: {
          subTaskIds: arrayMoveRight(parentSubTaskIds, id)
        }
      }, state);
    }

    case TaskActionTypes.AddTimeSpent: {
      const {id, date, duration} = action.payload;
      const task = getTaskById(id, state);
      const currentTimeSpentForTickDay = task.timeSpentOnDay && +task.timeSpentOnDay[date] || 0;

      return updateTimeSpentForTask(
        id, {
          ...task.timeSpentOnDay,
          [date]: (currentTimeSpentForTickDay + duration)
        },
        state
      );
    }

    case TaskActionTypes.RemoveTimeSpent: {
      const {id, date, duration} = action.payload;
      const task = getTaskById(id, state);
      const currentTimeSpentForTickDay = task.timeSpentOnDay && +task.timeSpentOnDay[date] || 0;

      return updateTimeSpentForTask(
        id, {
          ...task.timeSpentOnDay,
          [date]: Math.max((currentTimeSpentForTickDay - duration), 0)
        },
        state
      );
    }

    // case TaskActionTypes.RestoreTask: {
    //   const task = {...action.payload.task, isDone: false};
    //   const subTasks = action.payload.subTasks;
    //   const tasksToAdd = [mapTaskWithSubTasksToTask(task)];
    //
    //   if (subTasks && subTasks.length) {
    //     subTasks.forEach((subTask: TaskWithSubTasks) => {
    //       if (subTask && subTask.id) {
    //         tasksToAdd.push(mapTaskWithSubTasksToTask(subTask));
    //       }
    //     });
    //   }
    //   return {
    //     ...taskAdapter.addMany(tasksToAdd, state),
    //     XXXtodaysTaskIds: [
    //       task.id,
    //       ...state.XXXtodaysTaskIds
    //     ]
    //   };
    // }

    case TaskActionTypes.AddSubTask: {
      const {task, parentId} = action.payload;
      const parentTask = state.entities[parentId];

      // add item1
      const stateCopy = taskAdapter.addOne({
        ...task,
        parentId,
        // update timeSpent if first sub task and non present
        ...(
          (parentTask.subTaskIds.length === 0 && Object.keys(task.timeSpentOnDay).length === 0)
            ? {
              timeSpentOnDay: parentTask.timeSpentOnDay,
              timeSpent: calcTotalTimeSpent(parentTask.timeSpentOnDay)
            }
            : {}
        ),
        // update timeEstimate if first sub task and non present
        ...(
          (parentTask.subTaskIds.length === 0 && !task.timeEstimate)
            ? {timeEstimate: parentTask.timeEstimate}
            : {}
        )
      }, state);

      return {
        ...stateCopy,
        // update current task to new sub task if parent was current before
        ...(
          (state.currentTaskId === parentId)
            ? {currentTaskId: task.id}
            : {}
        ),
        // also add to parent task
        entities: {
          ...stateCopy.entities,
          [parentId]: {
            ...parentTask,
            subTaskIds: [...parentTask.subTaskIds, task.id]
          }
        }
      };
    }

    case TaskActionTypes.MoveToOtherProject:
    case TaskActionTypes.MoveToArchive: {
      let copyState = state;
      action.payload.tasks.forEach((task) => {
        copyState = deleteTask(copyState, task);
      });
      return {
        ...copyState
      };
    }

    case TaskActionTypes.ToggleStart: {
      if (state.currentTaskId) {
        return {
          ...state,
          lastCurrentTaskId: state.currentTaskId,
        };
      }
      return state;
    }

    case TaskRepeatCfgActionTypes.AddTaskRepeatCfgToTask: {
      return taskAdapter.updateOne({
        id: action.payload.taskId,
        changes: {
          repeatCfgId: action.payload.taskRepeatCfg.id
        }
      }, state);
    }

    default: {
      return state;
    }
  }
}
