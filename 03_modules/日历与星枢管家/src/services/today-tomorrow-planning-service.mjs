import { addDays } from '../domain/schedule-view.mjs';
import { classifyTask } from '../rules/schedule-rules.mjs';
import { createPrioritySuggestions } from '../planning/priority-suggestion.mjs';
import { createTodayViewModel } from '../view-models/today-view-model.mjs';
import { createTomorrowViewModel } from '../view-models/tomorrow-view-model.mjs';

export class TodayTomorrowPlanningService {
  constructor({ taskRepository, eventRepository, dailyPlanStore, reminderStore, notionStatusProvider=()=>null, commandDispatcher=null, dailyPlanningService=null, reminderIntegration=null }={}) {
    this.tasks=taskRepository; this.events=eventRepository; this.plans=dailyPlanStore; this.reminders=reminderStore; this.notionStatusProvider=notionStatusProvider;
    for (const [obj,method] of [[taskRepository,'list'],[eventRepository,'list'],[dailyPlanStore,'list'],[reminderStore,'list']]) if (!obj || typeof obj[method]!=='function') throw new TypeError(`dependency must provide ${method}()`);
    this.commandDispatcher=commandDispatcher; this.dailyPlanningService=dailyPlanningService; this.reminderIntegration=reminderIntegration;
  }
  collections() { return { tasks:this.tasks.list(), events:this.events.list(), plans:this.plans.list(), reminders:this.reminders.list() }; }
  suggestions(tasks, plans, date, now, timezone, carryover=[]) {
    const index=Object.fromEntries(tasks.map((t)=>[t.id,t]));
    const classified=tasks.map((task)=>({ task, flags:classifyTask(task,{tasksById:index,now,timezone}).flags }));
    return createPrioritySuggestions({ tasks:tasks.filter((t)=>!['completed','cancelled'].includes(t.status)), plans, plan_date:date, overdue_task_ids:classified.filter((x)=>x.flags.overdue).map((x)=>x.task.id), blocked_task_ids:classified.filter((x)=>x.flags.blocked).map((x)=>x.task.id), carryover_task_ids:carryover.map((x)=>x.task_id) });
  }
  getToday(date,{now,timezone,confirmation_pending=[],carryover_from_previous=[]}={}) {
    const c=this.collections(); const suggestions=this.suggestions(c.tasks,c.plans,date,now,timezone,carryover_from_previous);
    return createTodayViewModel({ date,...c,priority_suggestions:suggestions,carryover_from_previous,confirmation_pending,notion_status:this.notionStatusProvider(),now,timezone });
  }
  getTomorrow(today,{now,timezone,carryover_suggestions=[]}={}) {
    const date=addDays(today,1); const c=this.collections(); const suggestions=this.suggestions(c.tasks,c.plans,date,now,timezone,carryover_suggestions);
    return createTomorrowViewModel({ date,...c,priority_suggestions:suggestions,carryover_suggestions,now,timezone });
  }
  completeTask(command, { now, timezone }={}) {
    if (!this.commandDispatcher || typeof this.commandDispatcher.dispatch!=='function') throw new TypeError('commandDispatcher is required for completion');
    const result=this.commandDispatcher.dispatch(command,{now,timezone});
    if (result.status==='executed') {
      const taskId=command.payload.task_id;
      this.dailyPlanningService?.markTaskCompleted(taskId,{now});
      const task=this.tasks.getById(taskId);
      for (const plan of this.plans.list({task_id:taskId})) this.reminderIntegration?.reconcile({plan,task,now});
    }
    return result;
  }
}
