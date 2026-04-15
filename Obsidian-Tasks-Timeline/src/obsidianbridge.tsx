import { Model } from 'backbone';
import moment from 'moment';
import { App, ItemView, Menu, Notice, Pos } from 'obsidian';
import * as React from 'react';
import { UserOption, defaultUserOptions } from '../../src/settings';
import * as TaskMapable from '../../utils/taskmapable';
import { TaskDataModel } from '../../utils/tasks';
import { QuickEntryHandlerContext, TaskItemEventHandlersContext } from './components/context';
import { TimelineView } from './components/timelineview';

/**
 * Calculates the next recurrence date from a rule string and a reference date.
 * Returns null if the rule cannot be parsed.
 */
function calculateNextRecurrenceDate(rule: string, refDate: moment.Moment): moment.Moment | null {
    const r = rule.toLowerCase().trim();

    // "every N days/weeks/months/years"
    const nUnits = r.match(/^every\s+(\d+)\s+(day|week|month|year)s?/i);
    if (nUnits) {
        return refDate.clone().add(parseInt(nUnits[1]), nUnits[2] as moment.unitOfTime.DurationConstructor);
    }
    // "every day/week/month/year"
    const oneUnit = r.match(/^every\s+(day|week|month|year)s?/i);
    if (oneUnit) {
        return refDate.clone().add(1, oneUnit[1] as moment.unitOfTime.DurationConstructor);
    }
    // "every monday/tuesday/..."
    const weekdays = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const wdMatch = r.match(/^every\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)/i);
    if (wdMatch) {
        const targetDay = weekdays.indexOf(wdMatch[1].toLowerCase());
        const next = refDate.clone().add(1, 'days');
        while (next.day() !== targetDay) next.add(1, 'days');
        return next;
    }
    return null;
}

/**
 * Returns the number of lines starting at startLine that belong to the task
 * (the task line itself plus any immediately-following indented sub-lines).
 */
function collectTaskBlock(lines: string[], startLine: number): number {
    const taskIndent = (lines[startLine].match(/^(\s*)/) || ['', ''])[1].length;
    let lastNonBlankIndented = startLine;
    let i = startLine + 1;
    while (i < lines.length) {
        if (lines[i].trim() === '') { i++; continue; }
        const indent = (lines[i].match(/^(\s*)/) || ['', ''])[1].length;
        if (indent > taskIndent) { lastNonBlankIndented = i; i++; }
        else break;
    }
    return lastNonBlankIndented - startLine + 1;
}

const defaultObsidianBridgeProps = {
    plugin: {} as ItemView,
    userOptionModel: new Model({ ...defaultUserOptions }) as Model,
    taskListModel: new Model({ taskList: [] as TaskDataModel[] }) as Model,
}
const defaultObsidianBridgeState = {
    taskList: [] as TaskDataModel[],
    userOptions: defaultUserOptions as UserOption,
}
type ObsidianBridgeProps = Readonly<typeof defaultObsidianBridgeProps>;
type ObsidianBridgeState = typeof defaultObsidianBridgeState;
export class ObsidianBridge extends React.Component<ObsidianBridgeProps, ObsidianBridgeState> {
    //private readonly adapter: ObsidianTaskAdapter;
    private readonly app: App;
    constructor(props: ObsidianBridgeProps) {
        super(props);

        this.app = this.props.plugin.app;

        this.handleCreateNewTask = this.handleCreateNewTask.bind(this);
        this.handleTagClick = this.handleTagClick.bind(this);
        this.handleOpenFile = this.handleOpenFile.bind(this);
        this.handleCompleteTask = this.handleCompleteTask.bind(this);
        this.onUpdateTasks = this.onUpdateTasks.bind(this);
        this.onUpdateUserOption = this.onUpdateUserOption.bind(this);
        this.handleModifyTask = this.handleModifyTask.bind(this);
        this.handleFilterEnable = this.handleFilterEnable.bind(this);
        this.handleContextMenu = this.handleContextMenu.bind(this);
        this.handleArchiveTask = this.handleArchiveTask.bind(this);
        this.handleCompleteAndArchiveTask = this.handleCompleteAndArchiveTask.bind(this);

        //this.adapter = new ObsidianTaskAdapter(this.app);

        this.state = {
            userOptions: { ...(this.props.userOptionModel.pick(this.props.userOptionModel.keys()) as UserOption) },
            taskList: this.props.taskListModel.get("taskList"),
        }
    }

    componentDidMount(): void {

        this.props.taskListModel.on('change', this.onUpdateTasks)
        this.props.userOptionModel.on('change', this.onUpdateUserOption)
    }

    componentWillUnmount(): void {
        this.props.taskListModel.off('change', this.onUpdateTasks);
        this.props.userOptionModel.off('change', this.onUpdateUserOption);
    }

    onUpdateUserOption() {
        this.setState({
            userOptions: { ...(this.props.userOptionModel.pick(this.props.userOptionModel.keys()) as UserOption) }
        })
    }

    onUpdateTasks() {
        this.setState({
            taskList: this.props.taskListModel.get("taskList"),
        })
    }

    handleFilterEnable(startDate: string, endDate: string, priorities: string[]) {

        let taskList: TaskDataModel[] = this.props.taskListModel.get("taskList");

        if (startDate && startDate !== "" && endDate && endDate !== "") {
            taskList = taskList
                .filter(TaskMapable.filterDateRange(moment(startDate), moment(endDate)))
        }
        if (priorities.length !== 0) {
            taskList = taskList.filter((t: TaskDataModel) => priorities.includes(t.priority));
        }
        this.setState({
            taskList: taskList
        });
    }

    handleCreateNewTask(path: string, append: string) {
        const taskStr = "- [ ] " + append;
        const section = this.state.userOptions.sectionForNewTasks;
        this.app.vault.adapter.exists(path).then(exist => {
            if (!exist && confirm("No such file: " + path + ". Would you like to create it?")) {
                const content = section + "\n" + taskStr;
                this.app.vault.create(path, content)
                    .then(() => {
                        this.onUpdateTasks();
                    })
                    .catch(reason => {
                        return new Notice("Error when creating file " + path + " for new task: " + reason, 5000);
                    });
                return;
            }
            this.app.vault.adapter.read(path).then(content => {
                const lines = content.split('\n');
                lines.splice(lines.indexOf(section) + 1, 0, taskStr);
                this.app.vault.adapter.write(path, lines.join("\n"))
                    .then(() => {
                        this.onUpdateTasks();
                    })
                    .catch(reason => {
                        return new Notice("Error when writing new tasks to " + path + "." + reason, 5000);
                    });
            }).catch(reason => new Notice("Error when reading file " + path + "." + reason, 5000));
        })
    }


    handleTagClick(tag: string) {
        //@ts-ignore
        const searchPlugin = this.app.internalPlugins.getPluginById("global-search");
        const search = searchPlugin && searchPlugin.instance;
        search.openGlobalSearch('tag:' + tag)
    }

    handleOpenFile(path: string, position: Pos, openTaskEdit = false) {
        this.app.vault.adapter.exists(path).then(exist => {
            if (!exist) {
                new Notice("No such file: " + path, 5000);
                return;
            }
            this.app.workspace.openLinkText('', path).then(() => {
                try {
                    const file = this.app.workspace.getActiveFile();
                    file && this.app.workspace.getLeaf().openFile(file, { state: { mode: "source" } });
                    this.app.workspace.activeEditor?.editor?.setSelection(
                        { line: position.start.line, ch: position.start.col },
                        { line: position.start.line, ch: position.end.col }
                    )
                    if (!this.app.workspace.activeEditor?.editor?.hasFocus()) {
                        this.app.workspace.activeEditor?.editor?.focus();
                    }
                    if (openTaskEdit) {
                        const editor = this.app.workspace.activeEditor?.editor;
                        if (editor) {
                            const view = this.app.workspace.getLeaf().view;
                            //@ts-ignore
                            this.app.commands.commands['obsidian-tasks-plugin:edit-task']
                                .editorCheckCallback(false, editor, view);
                        }
                    }
                } catch (err) {
                    new Notice("Error when trying open file: " + err, 5000);
                }
            })
        }).catch(reason => {
            new Notice("Something went wrong: " + reason, 5000);
        })
    }

    handleModifyTask(path: string, position: Pos) {
        this.handleOpenFile(path, position, true);
    }

    handleCompleteTask(path: string, position: Pos, item: TaskDataModel) {
        this.app.vault.adapter.read(path).then(content => {
            const lines = content.split('\n');
            const originalLine = lines[position.start.line];
            if (!originalLine) {
                new Notice("Could not find task line.", 5000);
                return;
            }

            const isCompleting = item.statusMarker === ' ' || item.statusMarker === '';

            if (isCompleting) {
                // Mark as done
                let doneLine = originalLine.replace(/\[[ ]\]/, '[x]');
                if (!/✅\s*\d{4}-\d{2}-\d{2}/.test(doneLine)) {
                    doneLine = doneLine + ` ✅ ${moment().format('YYYY-MM-DD')}`;
                }
                lines[position.start.line] = doneLine;

                // Handle recurring task: insert next occurrence before the completed line
                if (item.recurrence) {
                    const refDate = item.due || item.scheduled || item.start;
                    if (refDate) {
                        const nextDate = calculateNextRecurrenceDate(item.recurrence, refDate);
                        if (nextDate) {
                            const nextDateStr = nextDate.format('YYYY-MM-DD');
                            // Build next task from original (pre-completion) line
                            let newLine = originalLine
                                .replace(/\[.\]/, '[ ]')
                                .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '');
                            if (item.due) {
                                newLine = newLine.replace(/[📅📆🗓]\s*\d{4}-\d{2}-\d{2}/u, `📅 ${nextDateStr}`);
                            } else if (item.scheduled) {
                                newLine = newLine.replace(/[⏳⌛]\s*\d{4}-\d{2}-\d{2}/u, `⏳ ${nextDateStr}`);
                            } else if (item.start) {
                                newLine = newLine.replace(/🛫\s*\d{4}-\d{2}-\d{2}/u, `🛫 ${nextDateStr}`);
                            }
                            // Insert the new task before the completed one
                            lines.splice(position.start.line, 0, newLine);
                        } else {
                            new Notice("Recurring task toggled, but recurrence rule could not be parsed. Please create the next occurrence manually.", 5000);
                        }
                    }
                }
            } else {
                // Mark as undone
                let undoneLine = originalLine.replace(/\[.\]/, '[ ]');
                undoneLine = undoneLine.replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '');
                lines[position.start.line] = undoneLine;
            }

            this.app.vault.adapter.write(path, lines.join('\n')).catch(reason => {
                new Notice("Error toggling task: " + reason, 5000);
            });
        }).catch(reason => {
            new Notice("Error reading file " + path + ": " + reason, 5000);
        });
    }

    handleArchiveTask(path: string, position: Pos, item: TaskDataModel) {
        const { archiveFolder, archiveFileFormat } = this.state.userOptions;
        if (!archiveFolder) {
            new Notice("No archive folder configured. Please set one in the plugin settings.", 5000);
            return;
        }
        const completionDate = item.completion ? item.completion : moment();
        const fileName = completionDate.format(archiveFileFormat || 'YYYY-MM-DD') + '.md';
        const folder = archiveFolder.replace(/\/$/, '');
        const archiveFilePath = folder + '/' + fileName;

        this.app.vault.adapter.read(path).then(content => {
            const lines = content.split('\n');
            if (!lines[position.start.line]) {
                new Notice("Could not find task line.", 5000);
                return;
            }
            // Remove the task line plus any indented sub-lines that belong to it
            const numLines = collectTaskBlock(lines, position.start.line);
            const archiveLines = lines.splice(position.start.line, numLines);
            const taskBlock = archiveLines.join('\n');
            // Collapse any triple+ blank lines left behind
            const newContent = lines.join('\n').replace(/\n{3,}/g, '\n\n');

            this.app.vault.adapter.exists(archiveFilePath).then(exists => {
                const writeSource = this.app.vault.adapter.write(path, newContent);
                const appendToArchive = exists
                    ? this.app.vault.adapter.read(archiveFilePath).then(archiveContent => {
                        const separator = archiveContent.endsWith('\n') ? '' : '\n';
                        return this.app.vault.adapter.write(archiveFilePath, archiveContent + separator + taskBlock + '\n');
                    })
                    : this.app.vault.adapter.exists(folder).then(folderExists => {
                        if (folderExists) {
                            return this.app.vault.create(archiveFilePath, taskBlock + '\n');
                        }
                        return this.app.vault.createFolder(folder).then(() =>
                            this.app.vault.create(archiveFilePath, taskBlock + '\n')
                        );
                    });

                Promise.all([writeSource, appendToArchive]).then(() => {
                    new Notice(`Task archived to ${archiveFilePath}`);
                }).catch(reason => {
                    new Notice("Error archiving task: " + reason, 5000);
                });
            }).catch(reason => new Notice("Error checking archive file: " + reason, 5000));
        }).catch(reason => new Notice("Error reading file " + path + ": " + reason, 5000));
    }

    handleCompleteAndArchiveTask(path: string, position: Pos, item: TaskDataModel) {
        const { archiveFolder, archiveFileFormat } = this.state.userOptions;
        if (!archiveFolder) {
            new Notice("No archive folder configured. Please set one in the plugin settings.", 5000);
            return;
        }
        const today = moment();
        const fileName = today.format(archiveFileFormat || 'YYYY-MM-DD') + '.md';
        const folder = archiveFolder.replace(/\/$/, '');
        const archiveFilePath = folder + '/' + fileName;

        this.app.vault.adapter.read(path).then(content => {
            const lines = content.split('\n');
            if (!lines[position.start.line]) {
                new Notice("Could not find task line.", 5000);
                return;
            }
            // Mark the task as done with today's completion date
            const originalLine = lines[position.start.line];
            let taskLine = originalLine.replace(/\[[ ]\]/, '[x]');
            if (!/✅\s*\d{4}-\d{2}-\d{2}/.test(taskLine)) {
                taskLine = taskLine + ` ✅ ${today.format('YYYY-MM-DD')}`;
            }
            lines[position.start.line] = taskLine;

            // For recurring tasks: insert next occurrence before the completed line
            let completedLineIdx = position.start.line;
            if (item.recurrence) {
                const refDate = item.due || item.scheduled || item.start;
                if (refDate) {
                    const nextDate = calculateNextRecurrenceDate(item.recurrence, refDate);
                    if (nextDate) {
                        const nextDateStr = nextDate.format('YYYY-MM-DD');
                        let newLine = originalLine
                            .replace(/\[.\]/, '[ ]')
                            .replace(/\s*✅\s*\d{4}-\d{2}-\d{2}/, '');
                        if (item.due) {
                            newLine = newLine.replace(/[📅📆🗓]\s*\d{4}-\d{2}-\d{2}/u, `📅 ${nextDateStr}`);
                        } else if (item.scheduled) {
                            newLine = newLine.replace(/[⏳⌛]\s*\d{4}-\d{2}-\d{2}/u, `⏳ ${nextDateStr}`);
                        } else if (item.start) {
                            newLine = newLine.replace(/🛫\s*\d{4}-\d{2}-\d{2}/u, `🛫 ${nextDateStr}`);
                        }
                        // Insert the new task before the completed one; completed task shifts down by 1
                        lines.splice(position.start.line, 0, newLine);
                        completedLineIdx = position.start.line + 1;
                    } else {
                        new Notice("Recurring task: recurrence rule could not be parsed. Please create the next occurrence manually.", 5000);
                    }
                }
            }

            // Collect the completed task line plus any indented sub-lines
            const numLines = collectTaskBlock(lines, completedLineIdx);
            const archiveLines = lines.splice(completedLineIdx, numLines);
            const taskBlock = archiveLines.join('\n');
            // Collapse any triple+ blank lines left behind
            const newContent = lines.join('\n').replace(/\n{3,}/g, '\n\n');

            this.app.vault.adapter.exists(archiveFilePath).then(exists => {
                const writeSource = this.app.vault.adapter.write(path, newContent);
                const appendToArchive = exists
                    ? this.app.vault.adapter.read(archiveFilePath).then(archiveContent => {
                        const separator = archiveContent.endsWith('\n') ? '' : '\n';
                        return this.app.vault.adapter.write(archiveFilePath, archiveContent + separator + taskBlock + '\n');
                    })
                    : this.app.vault.adapter.exists(folder).then(folderExists => {
                        if (folderExists) {
                            return this.app.vault.create(archiveFilePath, taskBlock + '\n');
                        }
                        return this.app.vault.createFolder(folder).then(() =>
                            this.app.vault.create(archiveFilePath, taskBlock + '\n')
                        );
                    });

                Promise.all([writeSource, appendToArchive]).then(() => {
                    new Notice(`Task completed and archived to ${archiveFilePath}`);
                }).catch(reason => {
                    new Notice("Error archiving task: " + reason, 5000);
                });
            }).catch(reason => new Notice("Error checking archive file: " + reason, 5000));
        }).catch(reason => new Notice("Error reading file " + path + ": " + reason, 5000));
    }

    handleContextMenu(e: React.MouseEvent, path: string, position: Pos, item: TaskDataModel) {
        e.preventDefault();
        const menu = new Menu();

        if (item.statusMarker !== 'x') {
            menu.addItem((menuItem) => {
                menuItem
                    .setTitle("Complete and archive this task")
                    .setIcon('archive')
                    .onClick(() => this.handleCompleteAndArchiveTask(path, position, item));
            });
        }

        if (item.statusMarker === 'x') {
            menu.addItem((menuItem) => {
                menuItem
                    .setTitle("Archive this task")
                    .setIcon('archive')
                    .onClick(() => this.handleArchiveTask(path, position, item));
            });
        }

        const todayStr = moment().format('YYYY-MM-DD');
        const tomorrowStr = moment().add(1, 'days').format('YYYY-MM-DD');

        const isToday = (item.scheduled && item.scheduled.format('YYYY-MM-DD') === todayStr) ||
                        (item.start && item.start.format('YYYY-MM-DD') === todayStr) ||
                        (item.due && item.due.format('YYYY-MM-DD') === todayStr);

        let targetDate = '';
        let label = '';
        if (isToday) {
            label = "Postpone to tomorrow";
            targetDate = tomorrowStr;
        } else {
            label = "Schedule to today";
            targetDate = todayStr;
        }

        const updateTaskDate = async (newDateStr: string, actionLabel: string) => {
          this.app.vault.adapter.read(path).then(content => {
            const lines = content.split('\n');
            let line = lines[position.start.line];
            
            const scheduledRegex = /[⏳⌛] *(\d{4}-\d{2}-\d{2})/;
            if (scheduledRegex.test(line)) {
              line = line.replace(scheduledRegex, `⏳ ${newDateStr}`);
            } else {
              line = line + ` ⏳ ${newDateStr}`;
            }
            
            lines[position.start.line] = line;
            this.app.vault.adapter.write(path, lines.join('\n')).then(() => {
              new Notice(`Task ${actionLabel.toLowerCase()}!`);
            }).catch(reason => {
              new Notice("Error when writing tasks: " + reason, 5000);
            });
          }).catch(reason => new Notice("Error when reading file " + path + "." + reason, 5000));
        };

        menu.addItem((submenu) => {
          submenu
            .setTitle(label)
            .setIcon('calendar-clock')
            .onClick(() => updateTaskDate(targetDate, label));
        });

        menu.addItem((submenu) => {
          submenu
            .setTitle("Postpone 7 days")
            .setIcon('calendar-clock')
            .onClick(() => updateTaskDate(moment().add(7, 'days').format('YYYY-MM-DD'), "Postpone 7 days"));
        });

        menu.addItem((submenu) => {
          submenu
            .setTitle("Postpone to 1st of next month")
            .setIcon('calendar-clock')
            .onClick(() => updateTaskDate(moment().add(1, 'months').startOf('month').format('YYYY-MM-DD'), "Postpone to 1st of next month"));
        });

        const tagPalette = this.state.userOptions.tagColorPalette;
        const coloredTags = Object.keys(tagPalette);
        if (coloredTags.length > 0) {
            menu.addSeparator();
            coloredTags.forEach(tag => {
                menu.addItem(menuItem => {
                    menuItem
                        .setTitle(`Set Tag to ${tag}`)
                        .setIcon('hashtag')
                        .onClick(async () => {
                            this.app.vault.adapter.read(path).then(content => {
                                const lines = content.split('\n');
                                let line = lines[position.start.line];
                                
                                const firstExistingUserTag = coloredTags.find(t => line.includes(t));
                                if (firstExistingUserTag) {
                                    line = line.replace(firstExistingUserTag, tag);
                                } else {
                                    line = line + ` ${tag}`;
                                }
                                
                                lines[position.start.line] = line;
                                this.app.vault.adapter.write(path, lines.join('\n')).then(() => {
                                    new Notice(`Task tag updated to ${tag}!`);
                                }).catch(reason => {
                                    new Notice("Error when writing tasks: " + reason, 5000);
                                });
                            }).catch(reason => new Notice("Error when reading file " + path + "." + reason, 5000));
                        });
                });
            });
        }

        menu.showAtMouseEvent(e.nativeEvent);
    }

    render(): React.ReactNode {
        console.debug("Now the root node are rendering with: ", this.state.taskList)
        console.debug("Now the root node are reddering with: ", this.state.userOptions)
        return (
            <QuickEntryHandlerContext.Provider
                value={{
                    handleCreateNewTask: this.handleCreateNewTask,
                    handleFilterEnable: this.handleFilterEnable
                }}>
                <TaskItemEventHandlersContext.Provider value={{
                    handleOpenFile: this.handleOpenFile,
                    handleCompleteTask: this.handleCompleteTask,
                    handleTagClick: this.handleTagClick,
                    // pass an undefined if the obsidian-tasks-plugin not installed
                    //@ts-ignore
                    handleModifyTask: this.app.plugins.plugins['obsidian-tasks-plugin'] === undefined ? undefined : this.handleModifyTask,
                    handleContextMenu: this.handleContextMenu,
                }}>
                    <TimelineView userOptions={this.state.userOptions} taskList={this.state.taskList} />
                </TaskItemEventHandlersContext.Provider>
            </QuickEntryHandlerContext.Provider>
        )
    }
}