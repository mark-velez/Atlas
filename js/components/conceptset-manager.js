define(['knockout', 
        'text!./conceptset-manager.html', 
        'appConfig', 
        'ohdsi.util', 
        'webapi/CDMResultsAPI',
        'vocabularyprovider',
        'webapi/ConceptSetAPI',
        'conceptsetbuilder/InputTypes/ConceptSet',
        'knockout.dataTables.binding', 
        'bootstrap',
        'faceted-datatable', 
        'databindings', 
        'negative-controls',
        'circe',
], function (ko, view, config, ohdsiUtil, cdmResultsAPI, vocabularyAPI, conceptSetAPI, ConceptSet) {
	function conceptsetManager(params) {
		var self = this;
		self.model = params.model;
		self.conceptSetName = ko.observable();
		self.conceptSets = ko.observableArray();
		self.defaultConceptSetName = "New Concept Set";
        self.displayEvidence = ko.pureComputed(function () {
                                    return (self.model.evidenceUrl() && self.model.evidenceUrl().length > 0);
                                });
        self.activeUtility = ko.observable("");
        self.loading = ko.observable(false);
        self.optimalConceptSet = ko.observable(null);
        self.optimizerRemovedConceptSet = ko.observable(null);
        self.optimizerSavingNew = ko.observable(false);
        self.optimizerSavingNewName = ko.observable();
        self.optimizerFoundSomething = ko.pureComputed(function() {
            var returnVal = false;
            if (self.optimalConceptSet() && 
                self.optimalConceptSet().length > 0 && 
                self.model.selectedConcepts() &&
                self.model.selectedConcepts().length > 0)
                {
                    returnVal = self.optimalConceptSet().length != self.model.selectedConcepts().length;
                }
            return returnVal;
        })
        // Set the default concept set to be the current concept set
        self.currentConceptSet = ko.observableArray();
        _.each(self.model.selectedConcepts(), (conceptSetItem) => {
            var item = {
                concept: conceptSetItem.concept,
                includeDescendants: conceptSetItem.includeDescendants(),
                includeMapped: conceptSetItem.includeMapped(),
                isExcluded: conceptSetItem.isExcluded(),
            }
            self.currentConceptSet().push(item);
        });            	
        self.compareCS1Id = ko.observable(self.model.currentConceptSet().id); // Init to the currently loaded cs
        self.compareCS1Caption = ko.observable(self.model.currentConceptSet().name());
        self.compareCS1ConceptSet = ko.observableArray(self.currentConceptSet());
        self.compareCS2Id = ko.observable(0);
        self.compareCS2Caption = ko.observable();
        self.compareCS2ConceptSet = ko.observableArray(null);
        self.compareResults = ko.observable();
        self.compareIds = ko.observable(null);
        self.compareError = ko.pureComputed(function() {
            return (self.compareCS1Id() == self.compareCS2Id())
        });
        self.compareReady = ko.pureComputed(function() {
            // both are specified & not the same
            var conceptSetsSpecifiedAndDifferent = (
                    (self.compareCS1Id() > 0 && self.compareCS2Id() > 0) &&
                    (self.compareCS1Id() != self.compareCS2Id())
                   );
            
            // Check to see if one of the concept sets is the one 
            // that is currently open. If so, check to see if it is
            // "dirty" and if so, we are not ready to compare.
            var currentConceptSetClean = true;
            if (conceptSetsSpecifiedAndDifferent && self.model.currentConceptSet()) {
                // If we passed the check above, then we'll enforce this condition
                // which also ensures that we have 2 valid concept sets specified
                if (self.compareCS1Id() == self.model.currentConceptSet().id || 
                    self.compareCS2Id() == self.model.currentConceptSet().id) {
                    // One of the concept sets that is involved in the comparison
                    // is the one that is currently loaded; check to see if it is dirty
                    currentConceptSetClean = !self.model.currentConceptSetDirtyFlag.isDirty();
                }
            }
            
            
            return (conceptSetsSpecifiedAndDifferent && currentConceptSetClean);
        });
        self.compareUnchanged = ko.pureComputed(function() {
            // both are specified & not the same
            var conceptSetsSpecifiedAndDifferent = (
                    (self.compareCS1Id() > 0 && self.compareCS2Id() > 0) &&
                    (self.compareCS1Id() != self.compareCS2Id())
                   );
            
            // Next, determine if one of the concept sets that was used to show
            // results was changed. In that case, we do not want to show the 
            // current results
            var currentComparisonCriteriaUnchanged = true;
            if (conceptSetsSpecifiedAndDifferent && self.compareIds()) {
                // Check to see if the comparison crtieria has changed
                currentComparisonCriteriaUnchanged = (self.compareIds() == (self.compareCS1Id() + "-" + self.compareCS2Id()))
            }
            
            return (conceptSetsSpecifiedAndDifferent && currentComparisonCriteriaUnchanged);
        });
        self.compareLoading = ko.observable(false);
        self.compareLoadingClass = ko.pureComputed(function() {
            return self.compareLoading() ? "fa fa-circle-o-notch fa-spin fa-lg" : "fa fa-question-circle fa-lg"
        })
        self.compareNewConceptSetName = ko.observable(self.model.currentConceptSet().name() + " - From Comparison");
        self.defaultResultsUrl = self.model.resultsUrl;
        self.currentResultSource = ko.observable();
        self.recordCountsRefreshing = ko.observable(false);
        self.recordCountClass = ko.pureComputed(function() {
            return self.recordCountsRefreshing() ? "fa fa-circle-o-notch fa-spin fa-lg" : "fa fa-database fa-lg";
        });
        
        self.resultSources = ko.computed(function () {
            var resultSources = [];
            $.each(config.services, function (sourceIndex, service) {
                $.each(service.sources, function (i, source) {
                    if (source.hasResults) {
                        resultSources.push(source);
                        if (source.resultsUrl == self.defaultResultsUrl()) {
                            self.currentResultSource(source);
                        }
                    }
                })
            });

            return resultSources;
        }, this);        
        
        self.useCF = ko.observable(false);
        
        self.fields = {
            membership: {
                propName: 'conceptIn1And2',
                value: d => { 
                    if (d.conceptIn1Only == 1) {
                        return '1 Only'   
                    } else if (d.conceptIn2Only == 1) {
                    	return '2 Only'
                    } else {
                    	return 'Both'
                    }
                },
                isColumn: true,
                isFacet: true,
                label: 'Match',
                isField: true,
            },
            id: {
                propName: 'conceptId',
                value: 'conceptId',
                isColumn: true,
                isFacet: false,
                label: 'Id',
                isField: true,
            },
            code: {
                propName: 'conceptCode',
                value: 'conceptCode',
                isColumn: true,
                isFacet: false,
                label: 'Code',
                isField: true,
            },
            name: {
                propName: 'conceptName',
                value: d => {
                    var valid = true; //d.INVALID_REASON_CAPTION == 'Invalid' ? 'invalid' : '';
                    return '<a class=' + valid + ' href=\'#/concept/' + d.conceptId + '\'>' + d.conceptName + '</a>';
                },
                isColumn: true,
                isFacet: false,
                label: 'Name',
                isField: true,
            },            
            class: {
                propName: 'conceptClassId',
                value: 'conceptClassId',
                isColumn: true,
                isFacet: true,
                label: 'Class',
                isField: true,
            },
            RC: {
                propName: 'recordCount',
                value: 'recordCount',
                isColumn: true,
                isFacet: false,
                label: '<i id="dtConeptManagerRC" class="fa fa-database" aria-hidden="true"></i> RC',
                isField: true,
            },
            DRC: {
                propName: 'descendantRecordCount',
                value: 'descendantRecordCount',
                isColumn: true,
                isFacet: false,
                label: '<i id="dtConeptManagerDRC" class="fa fa-database" aria-hidden="true"></i> DRC',
                isField: true,
            },
            domainId: {
                propName: 'domainId',
                value: 'domainId',
                isColumn: true,
                isFacet: true,
                label: 'Domain',
                isField: true,
            },        
            vocabularyId: {
                propName: 'vocabularyId',
                value: 'vocabularyId',
                isColumn: true,
                isFacet: true,
                label: 'Vocabulary',
                isField: true,
            },        
            fRC: {
                propName: 'fRecordCount',
                label: 'Has Records',
                value: d => {
                	var val = 0;
                	if (d.recordCount.replace) {
                		val = parseInt(d.recordCount.replace(/\,/g,'')); // Remove comma formatting and treat as int
                	} else {
                		val = d.recordCount;
                	}
                    if (val > 0) {
                        return 'true'
                    } else {
                        return 'false'
                    }
                },
                isField: true,
                isColumn: false,
                isFacet: true,
            },
            fDRC: {
                propName: 'fDescendantRecordCount',
                label: 'Has Descendant Records',
                value: d => {
                	var val = 0;
                	if (d.descendantRecordCount.replace) {
                		val = parseInt(d.descendantRecordCount.replace(/\,/g,'')); // Remove comma formatting and treat as int
                	} else {
                		val = d.descendantRecordCount;
                	}
                    if (val > 0) {
                        return 'true'
                    } else {
                        return 'false'
                    }
                },
                isField: true,
                isColumn: false,
                isFacet: true,
            },            
        }

        self.compareResultsColumns = [
            {                
                title: 'Match',
                data: d => { 
                    if (d.conceptIn1Only == 1) {
                        return '1 Only'   
                    } else if (d.conceptIn2Only == 1) {
                    	return '2 Only'
                    } else {
                    	return 'Both'
                    }
                },
            },
            {
                title: 'Id',
                data: d => d.conceptId,
            },
            {
                title: 'Code',
                data: d => d.conceptCode,
            },
            {
                title: 'Name',
                data: d => {
                    var valid = true; //d.INVALID_REASON_CAPTION == 'Invalid' ? 'invalid' : '';
                    return '<a class=' + valid + ' href=\'#/concept/' + d.conceptId + '\'>' + d.conceptName + '</a>';
                },
            },
            {
                title: 'Class',
                data: d => d.conceptClassId,
            },            
            {
                title: '<i id="dtConeptManagerRC" class="fa fa-database" aria-hidden="true"></i> RC',
                data: d => d.recordCount,
            },
            {
                title: '<i id="dtConeptManagerDRC" class="fa fa-database" aria-hidden="true"></i> DRC',
                data: d => d.descendantRecordCount,
            },
            {
                title: 'Domain Id',
                data: d => d.domainId,
            },
            {
                title: 'Vocabulary',
                data: d => d.vocabularyId,
            },        
		];

        self.compareResultsOptions = {
            lengthMenu: [[10, 25, 50, 100, -1], ['10', '25', '50', '100', 'All']],
            order: [[1, 'asc'], [2, 'desc']],
            Facets: [
                {
                    'caption': 'Match',
                    'binding': d => { 
                        if (d.conceptIn1Only == 1) {
                            return '1 Only'   
                        } else if (d.conceptIn2Only == 1) {
                            return '2 Only'
                        } else {
                            return 'Both'
                        }
                    },
                },
                {
                    'caption': 'Class',
                    'binding': d => d.conceptClassId,
                },
                {
                    'caption': 'Domain',
                    'binding': d => d.domainId,
                },
                {
                    'caption': 'Vocabulary',
                    'binding': d => d.vocabularyId,
                },
                {
                    'caption': 'Has Records',
                    'binding': d => {
                        var val = d.recordCount;
                        if (val.replace) 
                        	val = parseInt(val.replace(/\,/g,'')); // Remove comma formatting and treat as int
                        if (val > 0) {
                            return 'true'
                        } else {
                            return 'false'
                        }
                    },
                },
                {
                    'caption': 'Has Descendant Records',
                    'binding': d => {
                    	var val = d.descendantRecordCount;
                    	if (val.replace)
                        	val = parseInt(val.replace(/\,/g,'')); // Remove comma formatting and treat as int
                        if (val > 0) {
                            return 'true'
                        } else {
                            return 'false'
                        }
                    },
                },
            ]
        };
        
		self.renderLink = function (s, p, d) {
			return '<a href=\"#/conceptset/' + d.id + '/details\">' + d.name + '</a>';
		}

		self.saveClick = function () {
			self.saveConceptSet("#txtConceptSetName");
		}

		self.routeTo = function (mode) {
			if (self.model.currentConceptSet() == undefined) {
				document.location = '#/conceptset/0/' + mode;
			} else {
				document.location = '#/conceptset/' + self.model.currentConceptSet().id + '/' + mode;
			}
		}

		self.closeConceptSet = function () {
			if (self.model.currentConceptSetDirtyFlag.isDirty() && !confirm("Your concept set changes are not saved. Would you like to continue?")) {
				return;
			} else {
				pageModel.clearConceptSet();
				document.location = "#/conceptsets";
			}
		};

		self.conceptSetNameChanged = self.model.currentConceptSet().name.subscribe(function (newValue) {
			if ($.trim(newValue) == self.defaultConceptSetName) {
				$("#txtConceptSetName").css({
					'background-color': '#FF0000'
				});
			} else {
				$("#txtConceptSetName").css({
					'background-color': ''
				});
			}
		});

		self.saveConceptSet = function (txtElem, conceptSet, selectedConcepts) {
            if (conceptSet === undefined) {
                conceptSet = {};
                if (self.model.currentConceptSet() == undefined) {
                    conceptSet.id = 0;
                    conceptSet.name = self.conceptSetName;
                } else {
                    conceptSet = self.model.currentConceptSet();
                }
            }
            if (selectedConcepts === undefined) {
                selectedConcepts = self.model.selectedConcepts();
            }
			var abortSave = false;

			// Do not allow someone to save a concept set with the default name of "New Concept Set
			if (conceptSet && conceptSet.name() == self.defaultConceptSetName) {
				self.raiseConceptSetNameProblem('Please provide a different name for your concept set', txtElem);
				return;
			}

			// Next check to see that a concept set with this name does not already exist
			// in the database. Also pass the conceptSetId so we can make sure that the
			// current concept set is excluded in this check.
			var conceptSetId = conceptSet.id;
			var urlEncoded = encodeURI(config.services[0].url + 'conceptset/' + conceptSetId + '/' + conceptSet.name() + "/exists");
			var existanceCheckPromise = $.ajax({
				url: urlEncoded,
				method: 'GET',
				contentType: 'application/json',
				success: function (results) {
					if (results.length > 0) {
						self.raiseConceptSetNameProblem('A concept set with this name already exists. Please choose a different name.', txtElem);
						abortSave = true;
					}
				},
				error: function () {
					alert('An error occurred while attempting to load the concept from your currently configured provider.  Please check the status of your selection from the configuration button in the top right corner.');
				}
			});

			$.when(existanceCheckPromise).done(function () {
				if (abortSave) {
					return;
				}

				var conceptSetItems = [];

				for (var i = 0; i < selectedConcepts.length; i++) {
					var item = selectedConcepts[i];
					conceptSetItems.push({
						conceptId: item.concept.CONCEPT_ID,
						isExcluded: +item.isExcluded(),
						includeDescendants: +item.includeDescendants(),
						includeMapped: +item.includeMapped()
					});
				}

				var json = ko.toJSON(conceptSet);

				$.ajax({
					method: 'POST',
					url: config.services[0].url + 'conceptset/',
					contentType: 'application/json',
					data: json,
					dataType: 'json',
					success: function (data) {

						$.ajax({
							method: 'POST',
							url: config.services[0].url + 'conceptset/' + data.id + '/items',
							data: JSON.stringify(conceptSetItems),
							dataType: 'json',
							contentType: 'application/json',
							success: function (itemSave) {
								$('#conceptSetSaveDialog').modal('hide');
								document.location = '#/conceptset/' + data.id + '/details';
								self.compareResults(null);
								self.model.currentConceptSetDirtyFlag.reset();
							}
						});
					}
				});

			});
		}

		self.raiseConceptSetNameProblem = function (msg, elem) {
			if (self.model.currentConceptSet()) {
				self.model.currentConceptSet().name.valueHasMutated();
			}
			alert(msg);
			$(elem).select().focus();
		}
        
        self.exportCSV = function() {
            window.open(config.services[0].url + 'conceptset/' + self.model.currentConceptSet().id + '/export');
        }
        
        self.copy = function() {
            console.log("copy concept set: " + self.model.currentConceptSet().name());
            self.conceptSetName("COPY OF: " + self.model.currentConceptSet().name());
        	self.model.currentConceptSet(undefined);
        	self.saveConceptSet("#txtConceptSetName");
        }
        
        self.optimize = function() {
            self.activeUtility("optimize");
            self.loading(true);
            self.optimalConceptSet(null);
            self.optimizerRemovedConceptSet(null);
            $('conceptset-manager #modalConceptSetOptimize').modal('show');
            
            var conceptSetItems = [];

            for (var i = 0; i < self.model.selectedConcepts().length; i++) {
                var item = self.model.selectedConcepts()[i];
                conceptSetItems.push({
                    concept: item.concept,
                    isExcluded: +item.isExcluded(),
                    includeDescendants: +item.includeDescendants(),
                    includeMapped: +item.includeMapped()
                });
            }

			conceptSetItems = {items: conceptSetItems}
            
            vocabularyAPI.optimizeConceptSet(conceptSetItems).then(function (optimizationResults) {
            	var optimizedConcepts = [];
				_.each(optimizationResults.optimizedConceptSet.items, (item) => {
					optimizedConcepts.push(item);
				});            	
            	var removedConcepts = [];
				_.each(optimizationResults.removedConceptSet.items, (item) => {
					removedConcepts.push(item);
				});            	
                self.optimalConceptSet(optimizedConcepts);
                self.optimizerRemovedConceptSet(removedConcepts);
                self.loading(false);
                self.activeUtility("");
            });
        }
        
        self.overwriteConceptSet = function() {
            console.log("overwriteConceptSet");
            var newConceptSet = [];
            _.each(self.optimalConceptSet(), (item) => {
            	var newItem;
            	newItem = {
            		concept: item.concept,
            		isExcluded: ko.observable(item.isExcluded),
					includeDescendants: ko.observable(item.includeDescendants),
					includeMapped: ko.observable(item.includeMapped),
            	}
            	newConceptSet.push(newItem);
            })
            self.model.selectedConcepts(newConceptSet);
            $('conceptset-manager #modalConceptSetOptimize').modal('hide');
        }
        
        self.copyOptimizedConceptSet = function() {
            console.log("copyOptimizedConceptSet");
            if (self.model.currentConceptSet() == undefined) {
				self.optimizerSavingNewName(self.conceptSetName());
			} else {
				self.optimizerSavingNewName(self.model.currentConceptSet().name() + " - OPTIMIZED");
			}
            self.optimizerSavingNew(true);
        }
        
        self.saveNewOptimizedConceptSet = function() {
            console.log('save new concept set');
            var conceptSet = {};
            conceptSet.id = 0;
            conceptSet.name = self.optimizerSavingNewName;
            var selectedConcepts = [];
            _.each(self.optimalConceptSet(), (item) => {
            	var newItem;
            	newItem = {
            		concept: item.concept,
            		isExcluded: ko.observable(item.isExcluded),
					includeDescendants: ko.observable(item.includeDescendants),
					includeMapped: ko.observable(item.includeMapped),
            	}
            	selectedConcepts.push(newItem);
            })
            self.saveConceptSet("#txtOptimizerSavingNewName", conceptSet, selectedConcepts);
            self.optimizerSavingNew(false);
        }
        
        self.cancelSaveNewOptimizedConceptSet = function() {
            console.log("cancel");
            self.optimizerSavingNew(false);
        }
        
        self.chooseCS1 = function () {
            $('conceptset-manager #modalCS').modal('show');
            self.targetId = self.compareCS1Id;
            self.targetCaption = self.compareCS1Caption;
            self.targetExpression = self.compareCS1ConceptSet;
        }

        self.clearCS1 = function () {
            self.compareCS1Id(0);
            self.compareCS1Caption(null);
            self.compareCS1ConceptSet.removeAll();
            self.compareResults(null);
        }

        self.chooseCS2 = function () {
            $('conceptset-manager #modalCS').modal('show');
            self.targetId = self.compareCS2Id;
            self.targetCaption = self.compareCS2Caption;
            self.targetExpression = self.compareCS2ConceptSet;
        }

        self.clearCS2 = function () {
            self.compareCS2Id(0);
            self.compareCS2Caption(null);
            self.compareCS2ConceptSet.removeAll();
            self.compareResults(null);
        }

        self.conceptsetSelected = function (d) {
            $('conceptset-manager #modalCS').modal('hide');
            vocabularyAPI.getConceptSetExpression(d.id).then(function (csExpression) {
                self.targetId(d.id);
                self.targetCaption(d.name);
                self.targetExpression(csExpression.items);
            });
        }
        
        self.compareConceptSets = function() {
            console.log("compare");
            self.compareLoading(true);
            var compareTargets = [{items: self.compareCS1ConceptSet()}, {items: self.compareCS2ConceptSet()}];
            vocabularyAPI.compareConceptSet(compareTargets).then(function (compareResults) {
                var conceptIds = $.map(compareResults, function (o, n) {
                    return o.conceptId;
                });                
                cdmResultsAPI.getConceptRecordCount(self.currentResultSource().sourceKey, conceptIds, compareResults).then(function (rowcounts) {
                    //self.compareResults(null);
                    self.compareResults(compareResults);
            		self.compareIds(self.compareCS1Id() + "-" + self.compareCS2Id()); // Stash the currently selected concept ids so we can use this to determine when to show/hide results
                    self.compareLoading(false);
                });
            });
        }
        
        self.showSaveNewModal = function() {
            $('conceptset-manager #modalSaveNew').modal('show');
        }
        
        self.compareCreateNewConceptSet = function() {
            var dtItems = $('#compareResults table').DataTable().data();
            var conceptSet = {};
            conceptSet.id = 0;
            conceptSet.name = self.compareNewConceptSetName;
            var selectedConcepts = [];
            _.each(dtItems, (item) => {
                var concept;
                concept = {
                    CONCEPT_CLASS_ID: item.conceptClassId,
                    CONCEPT_CODE: item.conceptCode,
                    CONCEPT_ID: item.conceptId,
                    CONCEPT_NAME: item.conceptName,
                    DOMAIN_ID: item.domainId,
                    INVALID_REASON: null,
                    INVALID_REASON_CAPTION: null,
                    STANDARD_CONCEPT: null,
                    STANDARD_CONCEPT_CAPTION: null,
                    VOCABULARY_ID: null,                    
                }
            	var newItem;
            	newItem = {
            		concept: concept,
            		isExcluded: ko.observable(false),
					includeDescendants: ko.observable(false),
					includeMapped: ko.observable(false),
            	}
            	selectedConcepts.push(newItem);
            })
            self.saveConceptSet("#txtNewConceptSetName", conceptSet, selectedConcepts);
            $('conceptset-manager #modalSaveNew').modal('hide');
        }
        
        self.toggleOnSelectAllCheckbox = function(selector, selectAllElement) {
        	$(document).on('init.dt', selector, function (e, settings) {       		
            	$(selectAllElement).addClass("selected");
        	});
        }
        
        self.toggleOffSelectAllCheckbox = function(selector, selectAllElement) {
        	$(document).on('init.dt', selector, function (e, settings) { 
            	$(selectAllElement).removeClass("selected");
        	});
        }
        
        self.selectAllConceptSetItems = function(selector, props) {        	
            props = props || {};
            props.isExcluded = props.isExcluded || null;
            props.includeDescendants = props.includeDescendants || null;
            props.includeMapped = props.includeMapped || null;
            var selectAllValue = !($(selector).hasClass("selected"));
			$(selector).toggleClass("selected");
			_.each(self.model.selectedConcepts(), (conceptSetItem) => {
                if (props.isExcluded !== null) {
                    conceptSetItem.isExcluded(selectAllValue);                    
                }
                if (props.includeDescendants !== null) {
                    conceptSetItem.includeDescendants(selectAllValue);
                }
                if (props.includeMapped !== null) {
                    conceptSetItem.includeMapped(selectAllValue);
                }
			});
			self.model.resolveConceptSetExpression();  
        }
        
        self.refreshRecordCounts = function(obj, event) {
			if (event.originalEvent) {                
                // User changed event
                console.log("Record count refresh");
                self.recordCountsRefreshing(true);
                $("#dtConeptManagerRC").toggleClass("fa-database").toggleClass("fa-circle-o-notch").toggleClass("fa-spin");
                $("#dtConeptManagerDRC").toggleClass("fa-database").toggleClass("fa-circle-o-notch").toggleClass("fa-spin");
                var compareResults = self.compareResults();
                var conceptIds = $.map(compareResults, function(o, n) { 
                    return o.conceptId; 
                });
                cdmResultsAPI.getConceptRecordCount(self.currentResultSource().sourceKey, conceptIds, compareResults).then(function (rowcounts) {
                    self.compareResults(compareResults);
                    console.log('record counts different?');
                    self.recordCountsRefreshing(false);
					$("#dtConeptManagerRC").toggleClass("fa-database").toggleClass("fa-circle-o-notch").toggleClass("fa-spin");
					$("#dtConeptManagerDRC").toggleClass("fa-database").toggleClass("fa-circle-o-notch").toggleClass("fa-spin");
                });
            }
        }        
        
        self.delete = function() {
			if (!confirm("Delete concept set? Warning: deletion can not be undone!"))
				return;
			
            // reset view after save
			conceptSetAPI.deleteConceptSet(self.model.currentConceptSet().id).then(function (result) {
				self.model.currentConceptSet(null);
				document.location = "#/conceptsets"
			});
        }

        // Initialize the select all checkboxes
        var excludeCount = 0;
        var descendantCount = 0;
        var mappedCount = 0;
        _.each(self.model.selectedConcepts(), (conceptSetItem) => {
            if (conceptSetItem.isExcluded()) {
                excludeCount++;
            }
            if (conceptSetItem.includeDescendants()) {
                descendantCount++;
            }
            if (conceptSetItem.includeMapped()) {
                mappedCount++;
            }
        });        
        if (excludeCount == self.model.selectedConcepts().length) {
            self.toggleOnSelectAllCheckbox('.conceptSetTable', '#selectAllExclude');
        } else {
            self.toggleOffSelectAllCheckbox('.conceptSetTable', '#selectAllExclude');
        }
        if (descendantCount == self.model.selectedConcepts().length) {
            self.toggleOnSelectAllCheckbox('.conceptSetTable', '#selectAllDescendants');
        } else {
            self.toggleOffSelectAllCheckbox('.conceptSetTable', '#selectAllDescendants');
        }
        if (mappedCount == self.model.selectedConcepts().length) {            
            self.toggleOnSelectAllCheckbox('.conceptSetTable', '#selectAllMapped');
        } else {            
            self.toggleOffSelectAllCheckbox('.conceptSetTable', '#selectAllMapped');
        }
        // Create event handlers for all of the select all elements
        $(document).off('click', '#selectAllExclude');
        $(document).on('click', '#selectAllExclude', function() { self.selectAllConceptSetItems("#selectAllExclude", { isExcluded: true })});
        $(document).off('click', '#selectAllDescendants');
        $(document).on('click', '#selectAllDescendants', function() { self.selectAllConceptSetItems("#selectAllDescendants", { includeDescendants: true })});
        $(document).off('click', '#selectAllMapped');
        $(document).on('click', '#selectAllMapped', function() { self.selectAllConceptSetItems("#selectAllMapped", { includeMapped: true })});
	}

	var component = {
		viewModel: conceptsetManager,
		template: view
	};

	ko.components.register('conceptset-manager', component);
	return component;
});