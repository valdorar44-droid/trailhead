const { withGradleProperties } = require('@expo/config-plugins');

module.exports = (config) => {
  return withGradleProperties(config, (props) => {
    const existing = props.modResults.findIndex(
      item => item.key === 'android.kotlinVersion'
    );
    const entry = { type: 'property', key: 'android.kotlinVersion', value: '1.9.24' };
    if (existing >= 0) {
      props.modResults[existing] = entry;
    } else {
      props.modResults.push(entry);
    }
    return props;
  });
};
