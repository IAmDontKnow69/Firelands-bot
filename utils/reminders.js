const cron = require('node-cron');
const { loadDb, markPostEventReminder } = require('./database');

function hoursUntil(dateString) {
  const diff = new Date(dateString).getTime() - Date.now();
  return diff / (1000 * 60 * 60);
}

async function sendNoResponseReminders(client, config) {
  void client;
  void config;
}

async function sendPostEventCoachVerification(client, config) {
  void client;
  void config;
  const db = loadDb();
  for (const [eventId, event] of Object.entries(db.events)) {
    if (hoursUntil(event.date) <= -1) markPostEventReminder(eventId, true);
  }
}

function startReminderJobs(client, getConfig) {
  cron.schedule('0 * * * *', async () => {
    try {
      const config = getConfig();
      await sendNoResponseReminders(client, config);
      await sendPostEventCoachVerification(client, config);
    } catch (error) {
      console.error('Reminder job failed:', error);
    }
  });
}

module.exports = {
  startReminderJobs,
  sendNoResponseReminders,
  sendPostEventCoachVerification
};
