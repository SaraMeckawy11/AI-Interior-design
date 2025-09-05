import cron from "cron";
import https from "https";

const job = new cron.CronJob("*/14 * * * *", () => {
  https
    .get("https://ai-interior-design-g5oc.onrender.com/", (res) => {
      if (res.statusCode === 200) {
        console.log("Pinged successfully");
      } else {
        console.log("Failed to ping. Status Code: ", res.statusCode);
      }
    })
    .on("error", (e) => {
      console.error(`Error pinging: ${e.message}`);
    });
});

export default job;
