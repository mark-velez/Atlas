define(function (require, exports) {

	var $ = require('jquery');
	var config = require('appConfig');
	
	function getPredictiveProbability(sourceKey, conceptSetId) {
		var infoPromise = $.ajax({
			url: config.webAPIRoot + sourceKey + '/evidence/predictiveprobability/' + (conceptSetId || '-1'),
			error: function (error) {
				console.log("Error: " + error);
			}
		});
		return infoPromise;
	}
    
    function generatePredictiveProbability(sourceKey, conceptSetId, conceptSetName, conceptDomainId, targetDomainId, conceptIds) {
        var predictiveProbJob = $.ajax({
            url: config.webAPIRoot + sourceKey + '/evidence/predictiveprobability',
            method: 'POST',
            contentType: 'application/json',
            data: JSON.stringify({
                jobName: "PREDICTIVE_PROBABILITY_" + conceptSetId,
                conceptSetId: conceptSetId,
                conceptSetName: conceptSetName,
                conceptDomainId: conceptDomainId,
                targetDomainId: targetDomainId,
                conceptIds: conceptIds
            }),
            error: function (error) {
                console.log("Error: " + error);
            }
        });   
            
        return predictiveProbJob;
    }
    
    var api = {
		getPredictiveProbability: getPredictiveProbability,
        generatePredictiveProbability: generatePredictiveProbability
	}

	return api;
});