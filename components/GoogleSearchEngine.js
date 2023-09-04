import React from 'react';

class GoogleSearchEngine extends React.Component {
  componentDidMount () {
    (function() {
      var cx = '6458cb83c4a4642a0'; // Replace with your "Search Engine ID"
      var gcse = document.createElement('script');
      gcse.type = 'text/javascript';
      gcse.async = true;
      gcse.src = 'https://cse.google.com/cse.js?cx=' + cx;
      var s = document.getElementsByTagName('script')[0];
      s.parentNode.insertBefore(gcse, s);
    })();
  }
  render() {
    return (
      <div>
        <div className="gcse-search"></div>
      </div>
    );
  }
}

export default GoogleSearchEngine;
