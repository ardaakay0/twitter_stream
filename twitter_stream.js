const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const puppeteer = require('puppeteer');

// Twitter and Discord Credentials - replace these with your credentials
const TWITTER_USERNAME = 'YOUR_TWITTER_USERNAME';
const TWITTER_PASSWORD = 'YOUR_TWITTER_PASSWORD';
const TOKEN = 'YOUR_DISCORD_BOT_TOKEN';

// Discord Bot Setup
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// List of User-Agent strings to rotate
const userAgents = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.3 Safari/605.1.15',
  'Mozilla/5.0 (iPhone; CPU iPhone OS 14_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.1.1 Mobile/15E148 Safari/604.1',
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:89.0) Gecko/20100101 Firefox/89.0',
  'Mozilla/5.0 (Linux; Android 11; SM-G991B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/89.0.4389.105 Mobile Safari/537.36'
];

// Keep track of followed users and open tabs
let followedUsers = {};
let browser = null;

client.once('ready', async () => {
  console.log('Bot is online!');

  // Launch the browser at bot startup
  browser = await puppeteer.launch({
    headless: false, // Run in non-headless mode to see what's happening
    defaultViewport: null,
    args: ['--start-maximized'],
  });

  // Log into Twitter
  const page = await browser.newPage();
  await loginToTwitter(page);
});

// Discord command listener
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  const args = message.content.trim().split(/ +/);
  const command = args.shift().toLowerCase();

  // Command to follow a Twitter username
  if (command === '!follow') {
    const username = args[0];
    if (!username) {
      return message.channel.send('Please specify a Twitter username.');
    }

    if (followedUsers[username]) {
      return message.channel.send(`${username} is already being followed.`);
    }

    // Open a new tab to follow this user
    const newTab = await browser.newPage();
    followedUsers[username] = {
      page: newTab,
      lastTweet: '',
    };
    await followUser(newTab, username, message);
  }

  // Command to stop following a specific username
  if (command === '!unfollow') {
    const username = args[0];
    if (!username) {
      return message.channel.send('Please specify a Twitter username to unfollow.');
    }

    if (followedUsers[username]) {
      // Close the tab and remove the user from the followed users list
      await followedUsers[username].page.close();
      delete followedUsers[username];
      message.channel.send(`Stopped following @${username}.`);
    } else {
      message.channel.send(`@${username} is not currently being followed.`);
    }
  }

  // Command to stop following all usernames
  if (command === '!unfollowall') {
    for (const username in followedUsers) {
      await followedUsers[username].page.close();
    }
    followedUsers = {};
    message.channel.send('Stopped following all users.');
  }

  // Command to clean messages in the Discord channel
  if (command === '!clean') {
    try {
      const fetchedMessages = await message.channel.messages.fetch({ limit: 100 });
      await message.channel.bulkDelete(fetchedMessages);
      message.channel.send('Cleaned up the last 100 messages!');
    } catch (error) {
      console.error('Error cleaning messages:', error);
      message.channel.send('There was an error trying to clean the messages. Make sure I have the proper permissions.');
    }
  }

  // Command to show all followed users
  if (command === '!follows') {
    if (Object.keys(followedUsers).length === 0) {
      message.channel.send('No users are currently being followed.');
    } else {
      const followedList = Object.keys(followedUsers).map((username) => `@${username}`).join('\n');
      const embed = new EmbedBuilder()
        .setColor('#1DA1F2') // Twitter blue color
        .setTitle('Currently Followed Users')
        .setDescription(followedList)
        .setFooter({
          text: 'Followed Twitter Accounts',
          iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
        })
        .setTimestamp();

      message.channel.send({ embeds: [embed] });
    }
  }
});

// Function to log into Twitter with enough waiting time to ensure reliability
async function loginToTwitter(page) {
  try {
    // Step 1: Go to Twitter login page
    await page.goto('https://twitter.com/login', { waitUntil: 'networkidle2' });
    await delay(3000); // Allow extra time for the page to load completely

    // Step 2: Wait for the username input field and enter the username
    const usernameSelector = 'input[name="text"]';
    await page.waitForSelector(usernameSelector, { visible: true, timeout: 30000 }); // Wait up to 30 seconds if needed
    await page.type(usernameSelector, TWITTER_USERNAME, { delay: 100 }); // Type slowly to mimic human interaction
    await delay(2000); // Wait a bit after typing the username

    // Step 3: Click the fourth button (which is always the "Next" button)
    await page.waitForSelector('button', { visible: true, timeout: 30000 });
    const buttons = await page.$$('button');
    if (buttons.length >= 4) {
      await buttons[3].click(); // Click the fourth button
      await delay(5000); // Allow time for the page to transition to the password screen
    } else {
      throw new Error('Could not find the "Next" button.');
    }

    // Step 4: If the page is still on the username screen, try pressing "Enter"
    const passwordSelector = 'input[name="password"]';
    const isPasswordInputVisible = await page.$(passwordSelector);
    if (!isPasswordInputVisible) {
      console.log('Next button click may have failed, attempting to press Enter...');
      await page.keyboard.press('Enter');
      await delay(5000); // Allow time for the page to transition
    }

    // Step 5: Wait for the password input field and enter the password
    await page.waitForSelector(passwordSelector, { visible: true, timeout: 30000 });
    await page.type(passwordSelector, TWITTER_PASSWORD, { delay: 100 }); // Type slowly for reliability
    await delay(2000); // Wait a bit after typing the password

    // Step 6: Click the fifth button to log in
    await page.waitForSelector('button', { visible: true, timeout: 30000 });
    const loginButtons = await page.$$('button');
    if (loginButtons.length >= 5) {
      await loginButtons[4].click(); // Click the fifth button
    } else {
      throw new Error('Could not find the "Log in" button.');
    }

    // Step 7: Wait for navigation to complete
    await page.waitForNavigation({ waitUntil: 'networkidle2' });
    await delay(5000); // Final delay to ensure the dashboard is fully loaded

    console.log('Logged into Twitter successfully!');
  } catch (error) {
    console.error('Failed to log in to Twitter:', error);
  }
}

// Function to follow a specific user and check for new tweets by refreshing the page
async function followUser(tab, username, message) {
  try {
    await tab.goto(`https://twitter.com/${username}`, {
      waitUntil: 'networkidle2',
    });
    await tab.waitForSelector('article', { timeout: 30000 }); // Wait for tweets to load

    // Store the latest tweet text
    let lastTweet = await tab.evaluate(() => {
      const tweetElement = document.querySelector('article [lang]');
      return tweetElement ? tweetElement.innerText : null;
    });

    if (lastTweet) {
      const channel = message.channel;

      const embed = new EmbedBuilder()
        .setColor('#1DA1F2') // Twitter blue color
        .setAuthor({
          name: `@${username}`,
          iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
          url: `https://twitter.com/${username}`,
        })
        .setDescription(lastTweet)
        .setThumbnail('https://abs.twimg.com/icons/apple-touch-icon-192x192.png')
        .setFooter({
          text: 'Twitter',
          iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
        })
        .setTimestamp();

      channel.send({ content: `<@${message.author.id}>`, embeds: [embed] });
    } else {
      console.log(`No tweets found for ${username} at the moment.`);
    }

    // Function to refresh the page and check for new tweets
    async function checkForNewTweets() {
      try {
        // Rotate user-agent before each refresh
        const randomUserAgent = userAgents[Math.floor(Math.random() * userAgents.length)];
        await tab.setUserAgent(randomUserAgent);

        await tab.reload({ waitUntil: 'networkidle2' }); // Reload the page
        await tab.waitForSelector('article', { timeout: 30000 }); // Wait for tweets to load after refresh

        // Extract the latest tweet again
        const latestTweet = await tab.evaluate(() => {
          const tweetElement = document.querySelector('article [lang]');
          return tweetElement ? tweetElement.innerText : null;
        });

        // If there's a new tweet, send it to the Discord channel
        if (latestTweet && latestTweet !== lastTweet) {
          lastTweet = latestTweet; // Update lastTweet to the latest one
          const channel = message.channel;

          const embed = new EmbedBuilder()
            .setColor('#1DA1F2')
            .setAuthor({
              name: `@${username}`,
              iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
              url: `https://twitter.com/${username}`,
            })
            .setDescription(latestTweet)
            .setThumbnail('https://abs.twimg.com/icons/apple-touch-icon-192x192.png')
            .setFooter({
              text: 'Twitter',
              iconURL: 'https://abs.twimg.com/icons/apple-touch-icon-192x192.png',
            })
            .setTimestamp();

          channel.send({ content: `<@${message.author.id}>`, embeds: [embed] });
        }
      } catch (error) {
        console.error(`Error while refreshing and checking for new tweets from ${username}:`, error);
      }

      // Set a randomized timeout between 45 and 60 seconds
      const randomInterval = Math.floor(Math.random() * (60000 - 45000 + 1)) + 45000;
      setTimeout(checkForNewTweets, randomInterval);
    }

    // Start checking for new tweets
    checkForNewTweets();

  } catch (error) {
    console.error(`Error setting up follow for ${username}:`, error);
  }
}

// Helper function to add delays
function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time);
  });
}

// Login to Discord with your bot token
client.login(TOKEN);
