import { JiraApiClient } from './services/jira-api.client';

/**
 * Provides the shared Jira API client instance used by this extension.
 */
export const jiraApiClient = new JiraApiClient();
