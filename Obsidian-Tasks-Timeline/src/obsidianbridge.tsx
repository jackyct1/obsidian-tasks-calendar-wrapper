import { Model } from 'backbone';
import moment from 'moment';
import { App, ItemView, Menu, Notice, Pos } from 'obsidian';
import * as React from 'react';
import { UserOption, defaultUserOptions } from '../../src/settings';
import * as TaskMapable from '../../utils/taskmapable';
import { TaskDataModel } from '../../utils/tasks';
import { QuickEntryHandlerContext, TaskItemEventHandlersContext } from './components/context';
import { TimelineView } from './components/timelineview';

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

    handleCompleteTask(path: string, position: Pos) {
        this.app.workspace.openLinkText('', path).then(() => {
            const file = this.app.workspace.getActiveFile();
            this.app.workspace.getLeaf().openFile(file!, { state: { mode: "source" } });
            this.app.workspace.activeEditor?.editor?.setSelection(
                { line: position.start.line, ch: position.start.col },
                { line: position.start.line, ch: position.start.col }
            );
            if (!this.app.workspace.activeEditor?.editor?.hasFocus())
                this.app.workspace.activeEditor?.editor?.focus();
            const editor = this.app.workspace.activeEditor?.editor;
            if (editor) {
                const view = this.app.workspace.getLeaf().view;
                //@ts-ignore
                this.app.commands.commands['obsidian-tasks-plugin:toggle-done']
                    .editorCheckCallback(false, editor, view);
            }
        })
    }

    handleArchiveTask(path: string, position: Pos) {
        const archiveFile = this.state.userOptions.archiveFile;
        if (!archiveFile) {
            new Notice("No archive file configured. Please set one in the plugin settings.", 5000);
            return;
        }
        this.app.vault.adapter.read(path).then(content => {
            const lines = content.split('\n');
            const taskLine = lines[position.start.line];
            if (!taskLine) {
                new Notice("Could not find task line.", 5000);
                return;
            }
            // Remove the task line from the source file
            lines.splice(position.start.line, 1);
            // Remove a trailing blank line left behind, if any
            const newContent = lines.join('\n').replace(/\n{3,}/g, '\n\n');

            this.app.vault.adapter.exists(archiveFile).then(exists => {
                const writeSource = this.app.vault.adapter.write(path, newContent);
                const appendToArchive = exists
                    ? this.app.vault.adapter.read(archiveFile).then(archiveContent => {
                        const separator = archiveContent.endsWith('\n') ? '' : '\n';
                        return this.app.vault.adapter.write(archiveFile, archiveContent + separator + taskLine + '\n');
                    })
                    : this.app.vault.create(archiveFile, taskLine + '\n');

                Promise.all([writeSource, appendToArchive]).then(() => {
                    new Notice("Task archived successfully.");
                }).catch(reason => {
                    new Notice("Error archiving task: " + reason, 5000);
                });
            }).catch(reason => new Notice("Error checking archive file: " + reason, 5000));
        }).catch(reason => new Notice("Error reading file " + path + ": " + reason, 5000));
    }

    handleContextMenu(e: React.MouseEvent, path: string, position: Pos, item: TaskDataModel) {
        e.preventDefault();
        const menu = new Menu();

        if (item.statusMarker === 'x') {
            menu.addItem((menuItem) => {
                menuItem
                    .setTitle("Archive this task")
                    .setIcon('archive')
                    .onClick(() => this.handleArchiveTask(path, position));
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

        menu.addItem((submenu) => {
            submenu
                .setTitle(label)
                .setIcon('calendar-clock')
                .onClick(async () => {
                    this.app.vault.adapter.read(path).then(content => {
                        const lines = content.split('\n');
                        let line = lines[position.start.line];
                        
                        const scheduledRegex = /[⏳⌛] *(\d{4}-\d{2}-\d{2})/;
                        if (scheduledRegex.test(line)) {
                            line = line.replace(scheduledRegex, `⏳ ${targetDate}`);
                        } else {
                            line = line + ` ⏳ ${targetDate}`;
                        }
                        
                        lines[position.start.line] = line;
                        this.app.vault.adapter.write(path, lines.join('\n')).then(() => {
                            new Notice(`Task ${label.toLowerCase()}!`);
                        }).catch(reason => {
                            new Notice("Error when writing tasks: " + reason, 5000);
                        });
                    }).catch(reason => new Notice("Error when reading file " + path + "." + reason, 5000));
                });
        });

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