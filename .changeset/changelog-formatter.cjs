const getReleaseLine = async (changeset) => {
  const [firstLine, ...futureLines] = changeset.summary.split('\n').map((line) => line.trimEnd());
  let line = `- ${firstLine}`;
  if (futureLines.length > 0) {
    line += `\n${futureLines.map((entry) => `  ${entry}`).join('\n')}`;
  }
  return line;
};

const getDependencyReleaseLine = async (_changesets, dependenciesUpdated) => {
  if (dependenciesUpdated.length === 0) return '';
  const updated = dependenciesUpdated.map(
    (dependency) => `  - ${dependency.name}@${dependency.newVersion}`,
  );
  return ['- Updated dependencies', ...updated].join('\n');
};

module.exports = { getReleaseLine, getDependencyReleaseLine };
