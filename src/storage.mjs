import { rmSync } from "node:fs";
import path from "node:path";
import { createDb } from "./storage/db.mjs";
import { createNoteStore } from "./storage/note-store.mjs";
import { createAccountStore } from "./storage/account-store.mjs";
import { createXhsStore } from "./storage/xhs-store.mjs";
import { createStatsStore } from "./storage/stats-store.mjs";
import { envWithSettings } from "./settings.mjs";

export class Storage {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.db = createDb(rootDir);
    this.notes = createNoteStore(this.db, rootDir);
    this.accounts_ = createAccountStore(this.db);
    this.xhs_ = createXhsStore(this.db);
    this.stats_ = createStatsStore(this.db, (id) => this.getNote(id), (noteId) => this.notes.listAssetsByNote(noteId));
    this.getAnalysis = this.notes.getAnalysis.bind(this.notes);
    this.listAssetsByNote = this.notes.listAssetsByNote.bind(this.notes);
    this.getAsset = this.notes.getAsset.bind(this.notes);

    // Delegate all methods from sub-stores
    // Notes
    this.findNoteBySourceUrl = this.notes.findNoteBySourceUrl.bind(this.notes);
    this.upsertNote = this.notes.upsertNote.bind(this.notes);
    this.getNote = this.notes.getNote.bind(this.notes);
    this.listNotes = this.notes.listNotes.bind(this.notes);
    this.addAssets = this.notes.addAssets.bind(this.notes);
    this.deleteNote = this.notes.deleteNote.bind(this.notes);
    this.batchDeleteNotes = this.notes.batchDeleteNotes.bind(this.notes);
    this.saveAnalysis = this.notes.saveAnalysis.bind(this.notes);
    this.getComments = this.notes.getComments.bind(this.notes);
    this.saveComments = this.notes.saveComments.bind(this.notes);
    this.createJob = this.notes.createJob.bind(this.notes);
    this.updateJob = this.notes.updateJob.bind(this.notes);
    this.listJobs = this.notes.listJobs.bind(this.notes);
    this.exportNotes = this.notes.exportNotes.bind(this.notes);
    this.batchUpdateTags = this.notes.batchUpdateTags.bind(this.notes);
    this.batchUpdateBrand = this.notes.batchUpdateBrand.bind(this.notes);
    this.setNoteLibraryType = this.notes.setNoteLibraryType.bind(this.notes);
    this.batchSetLibraryType = this.notes.batchSetLibraryType.bind(this.notes);

    // Accounts
    this.createAccount = this.accounts_.createAccount.bind(this.accounts_);
    this.listAccounts = this.accounts_.listAccounts.bind(this.accounts_);
    this.getAccount = this.accounts_.getAccount.bind(this.accounts_);
    this.updateAccount = this.accounts_.updateAccount.bind(this.accounts_);
    this.deleteAccount = this.accounts_.deleteAccount.bind(this.accounts_);
    this.getRecentBrands = this.accounts_.getRecentBrands.bind(this.accounts_);
    this.listFollowedAccounts = this.accounts_.listFollowedAccounts.bind(this.accounts_);
    this.getFollowedAccount = this.accounts_.getFollowedAccount.bind(this.accounts_);
    this.getFollowedAccountByUserId = this.accounts_.getFollowedAccountByUserId.bind(this.accounts_);
    this.upsertFollowedAccount = this.accounts_.upsertFollowedAccount.bind(this.accounts_);
    this.deleteFollowedAccount = this.accounts_.deleteFollowedAccount.bind(this.accounts_);
    this.createFollowCheck = this.accounts_.createFollowCheck.bind(this.accounts_);
    this.getFollowTimeline = this.accounts_.getFollowTimeline.bind(this.accounts_);

    // XHS + Tasks + Notifications
    this.listXhsAccounts = this.xhs_.listXhsAccounts.bind(this.xhs_);
    this.getXhsAccount = this.xhs_.getXhsAccount.bind(this.xhs_);
    this.upsertXhsAccount = this.xhs_.upsertXhsAccount.bind(this.xhs_);
    this.deleteXhsAccount = this.xhs_.deleteXhsAccount.bind(this.xhs_);
    this.createNotification = this.xhs_.createNotification.bind(this.xhs_);
    this.getNotification = this.xhs_.getNotification.bind(this.xhs_);
    this.listNotifications = this.xhs_.listNotifications.bind(this.xhs_);
    this.getUnreadNotificationCount = this.xhs_.getUnreadNotificationCount.bind(this.xhs_);
    this.markNotificationRead = this.xhs_.markNotificationRead.bind(this.xhs_);
    this.markAllNotificationsRead = this.xhs_.markAllNotificationsRead.bind(this.xhs_);
    this.deleteNotification = this.xhs_.deleteNotification.bind(this.xhs_);
    this.clearAllNotifications = this.xhs_.clearAllNotifications.bind(this.xhs_);
    this.createScheduledTask = this.xhs_.createScheduledTask.bind(this.xhs_);
    this.getScheduledTask = this.xhs_.getScheduledTask.bind(this.xhs_);
    this.listScheduledTasks = this.xhs_.listScheduledTasks.bind(this.xhs_);
    this.updateScheduledTask = this.xhs_.updateScheduledTask.bind(this.xhs_);
    this.deleteScheduledTask = this.xhs_.deleteScheduledTask.bind(this.xhs_);
    this.getDueTasks = this.xhs_.getDueTasks.bind(this.xhs_);
    this.createTaskLog = this.xhs_.createTaskLog.bind(this.xhs_);
    this.finishTaskLog = this.xhs_.finishTaskLog.bind(this.xhs_);
    this.listTaskLogs = this.xhs_.listTaskLogs.bind(this.xhs_);
    this.listMonitorSources = this.xhs_.listMonitorSources.bind(this.xhs_);

    // Stats
    this.getStats = this.stats_.getStats.bind(this.stats_);
    this.getInteractionStats = this.stats_.getInteractionStats.bind(this.stats_);
    this.getTopNotes = this.stats_.getTopNotes.bind(this.stats_);
    this.getTagCloud = this.stats_.getTagCloud.bind(this.stats_);
  }
}
