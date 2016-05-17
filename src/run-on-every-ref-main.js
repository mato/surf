import {Observable} from 'rx';
import request from 'request-promise';
import {getOriginForRepo} from './git-api';
import {getSanitizedRepoUrl, getNwoFromRepoUrl} from './github-api';
import createRefServer from './ref-server-api';

import BuildMonitor from './build-monitor';
import './custom-rx-operators';

const d = require('debug')('surf:run-on-every-ref');

function getRandomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export default async function main(argv, showHelp) {
  let cmdWithArgs = argv._;
  let repo = argv.r;
  let server = argv.s;
  
  if (argv.help) {
    showHelp();
    process.exit(0);
  }

  if (cmdWithArgs.length < 1) {
    console.log("Command to run not specified, defaulting to 'surf-build'");
    cmdWithArgs = ['surf-build', '-n', 'surf'];
  }

  if (!repo) {
    try {
      repo = getSanitizedRepoUrl(await getOriginForRepo('.'));
      console.error(`Repository not specified, using current directory: ${repo}`);
    } catch (e) {
      console.error("Repository not specified and current directory is not a Git repo");
      d(e.stack);

      showHelp();
      process.exit(-1);
    }
  }

  if (!server) {
    console.error(`
**** Becoming a Surf Server ****

If you're only setting up a single build client, this is probably what you want.
If you're setting up more than one, you'll want to run 'surf-server' somewhere,
then pass '-s' to all of your build clients.`);

    let nwo = getNwoFromRepoUrl(repo);
    createRefServer([nwo]);

    server = `http://localhost:${process.env.SURF_PORT || 3000}`;
  }

  let jobs = parseInt(argv.j || '2');
  if (argv.j && (jobs < 1 || jobs > 64)) {
    console.error("--jobs must be an integer");
    showHelp();
    process.exit(-1);
  }

  // Do an initial fetch to get our initial state
  let refInfo = null;
  let nwo = getNwoFromRepoUrl(repo);
  let surfUrl = `${server}/info/${nwo}`;

  let fetchRefs = () => {
    return request({
      uri: surfUrl,
      json: true
    });
  };
  
  let fetchRefsWithRetry = Observable.defer(() => 
    Observable.fromPromise(fetchRefs())
      .delayFailures(getRandomInt(1000, 6000)))
    .retry(5);

  refInfo = await fetchRefsWithRetry.toPromise();

  // TODO: figure out a way to trap Ctrl-C and dispose stop
  console.log(`Watching ${repo}, will run '${cmdWithArgs.join(' ')}'\n`);
  let buildMonitor = new BuildMonitor(cmdWithArgs, repo, jobs, () => fetchRefsWithRetry, refInfo);
  buildMonitor.start();

  return new Promise(() => {});
}